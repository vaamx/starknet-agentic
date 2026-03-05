import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Account, RpcProvider } from "starknet";
import { config } from "./config";
import {
  deletePersistedAgentKey,
  getPersistedAgentKey,
  upsertPersistedAgentKey,
  type PersistedAgentKeyMaterial,
  type PersistedAgentKeyProvider,
} from "./state-store";
import type { SpawnedAgent } from "./agent-spawner";

const LOCAL_IV_BYTES = 12;
const localProvider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });
const inMemoryPrivateKeys = new Map<string, string>();

export interface StoredAgentKeyRef {
  provider: PersistedAgentKeyProvider;
  keyRef: string;
}

function getCustodyProvider(): PersistedAgentKeyProvider {
  return config.agentKeyCustodyProvider;
}

function normalizePrivateKey(privateKey: string): string {
  const trimmed = privateKey.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function normalizeWalletAddress(address: string): string {
  return address.trim().toLowerCase();
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function buildKeyRef(agentId: string, provider: PersistedAgentKeyProvider): string {
  return `${provider}:${agentId}`;
}

function deriveLocalMasterKey(): Uint8Array | null {
  const raw = config.agentKeyCustodyMasterKey.trim();
  if (!raw) return null;

  const value = raw.startsWith("base64:") ? raw.slice(7) : raw;
  const decoded = raw.startsWith("base64:")
    ? Buffer.from(value, "base64")
    : /^[0-9a-fA-F]+$/.test(value)
      ? Buffer.from(value, "hex")
      : Buffer.from(value, "utf8");

  if (decoded.length === 32) return Uint8Array.from(decoded);
  return Uint8Array.from(
    createHash("sha256").update(Uint8Array.from(decoded)).digest()
  );
}

function localEncrypt(plaintext: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const masterKey = deriveLocalMasterKey();
  if (!masterKey) {
    throw new Error(
      "AGENT_KEY_CUSTODY_MASTER_KEY is required for local-encrypted custody"
    );
  }

  const iv = randomBytes(LOCAL_IV_BYTES);
  const ivBytes = Uint8Array.from(iv);
  const cipher = createCipheriv("aes-256-gcm", masterKey, ivBytes);
  const encryptedHead = cipher.update(plaintext, "utf8");
  const encryptedTail = cipher.final();
  const encrypted = new Uint8Array(encryptedHead.length + encryptedTail.length);
  encrypted.set(encryptedHead, 0);
  encrypted.set(encryptedTail, encryptedHead.length);
  const authTag = Uint8Array.from(cipher.getAuthTag());

  return {
    ciphertext: toBase64(encrypted),
    iv: toBase64(ivBytes),
    authTag: toBase64(authTag),
  };
}

function localDecrypt(material: PersistedAgentKeyMaterial): string {
  const masterKey = deriveLocalMasterKey();
  if (!masterKey) {
    throw new Error(
      "AGENT_KEY_CUSTODY_MASTER_KEY is required for local-encrypted custody"
    );
  }
  if (!material.iv || !material.authTag) {
    throw new Error("Local-encrypted key material is missing iv/authTag");
  }

  const iv = fromBase64(material.iv);
  const authTag = fromBase64(material.authTag);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);

  const decryptedHead = decipher.update(fromBase64(material.ciphertext));
  const decryptedTail = decipher.final();
  const decrypted = new Uint8Array(decryptedHead.length + decryptedTail.length);
  decrypted.set(decryptedHead, 0);
  decrypted.set(decryptedTail, decryptedHead.length);

  return new TextDecoder().decode(decrypted);
}

async function loadAwsKmsModule(): Promise<any> {
  const importer = new Function("name", "return import(name)") as (
    name: string
  ) => Promise<any>;
  return await importer("@aws-sdk/client-kms");
}

async function awsKmsEncrypt(privateKey: string): Promise<{
  ciphertext: string;
  awsKmsKeyId?: string;
}> {
  if (!config.agentKeyCustodyAwsKmsKeyId) {
    throw new Error(
      "AGENT_KEY_CUSTODY_AWS_KMS_KEY_ID is required for aws-kms custody"
    );
  }

  const mod = await loadAwsKmsModule();
  const KMSClient = mod.KMSClient as new (...args: any[]) => any;
  const EncryptCommand = mod.EncryptCommand as new (...args: any[]) => any;
  const client = new KMSClient({
    region: config.agentKeyCustodyAwsRegion || undefined,
  });

  const result = await client.send(
    new EncryptCommand({
      KeyId: config.agentKeyCustodyAwsKmsKeyId,
      Plaintext: new TextEncoder().encode(privateKey),
    })
  );

  const blob = result.CiphertextBlob as Uint8Array | undefined;
  if (!blob || blob.length === 0) {
    throw new Error("AWS KMS encrypt returned empty ciphertext");
  }

  return {
    ciphertext: toBase64(blob),
    awsKmsKeyId:
      typeof result.KeyId === "string" ? result.KeyId : undefined,
  };
}

async function awsKmsDecrypt(material: PersistedAgentKeyMaterial): Promise<string> {
  const mod = await loadAwsKmsModule();
  const KMSClient = mod.KMSClient as new (...args: any[]) => any;
  const DecryptCommand = mod.DecryptCommand as new (...args: any[]) => any;
  const client = new KMSClient({
    region: config.agentKeyCustodyAwsRegion || undefined,
  });

  const result = await client.send(
    new DecryptCommand({
      CiphertextBlob: fromBase64(material.ciphertext),
      KeyId: material.awsKmsKeyId || config.agentKeyCustodyAwsKmsKeyId || undefined,
    })
  );

  const plaintext = result.Plaintext as Uint8Array | undefined;
  if (!plaintext || plaintext.length === 0) {
    throw new Error("AWS KMS decrypt returned empty plaintext");
  }
  return new TextDecoder().decode(plaintext);
}

async function decryptMaterial(material: PersistedAgentKeyMaterial): Promise<string> {
  if (material.provider === "local-encrypted") {
    return localDecrypt(material);
  }
  if (material.provider === "aws-kms") {
    return await awsKmsDecrypt(material);
  }
  throw new Error(`Unsupported persisted key provider: ${material.provider}`);
}

export function hasAgentSigningMaterial(
  agent:
    | Pick<SpawnedAgent, "id" | "walletAddress" | "privateKey" | "keyRef" | "account">
    | null
    | undefined
): boolean {
  if (!agent) return false;
  return Boolean(agent.account || agent.privateKey || agent.keyRef);
}

export async function storeAgentPrivateKey(params: {
  agentId: string;
  walletAddress: string;
  privateKey: string;
}): Promise<StoredAgentKeyRef> {
  const normalizedKey = normalizePrivateKey(params.privateKey);
  if (!normalizedKey) {
    throw new Error("Cannot store empty private key");
  }

  const normalizedAddress = normalizeWalletAddress(params.walletAddress);
  const provider = getCustodyProvider();
  const keyRef = buildKeyRef(params.agentId, provider);
  const now = Date.now();

  if (provider === "memory") {
    inMemoryPrivateKeys.set(params.agentId, normalizedKey);
    return { provider, keyRef };
  }

  let material: PersistedAgentKeyMaterial;
  if (provider === "local-encrypted") {
    const encrypted = localEncrypt(normalizedKey);
    material = {
      agentId: params.agentId,
      walletAddress: normalizedAddress,
      provider,
      keyRef,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      createdAt: now,
      updatedAt: now,
    };
  } else if (provider === "aws-kms") {
    const encrypted = await awsKmsEncrypt(normalizedKey);
    material = {
      agentId: params.agentId,
      walletAddress: normalizedAddress,
      provider,
      keyRef,
      ciphertext: encrypted.ciphertext,
      awsKmsKeyId: encrypted.awsKmsKeyId,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    throw new Error(`Unsupported key custody provider: ${provider}`);
  }

  await upsertPersistedAgentKey(material);
  inMemoryPrivateKeys.set(params.agentId, normalizedKey);
  return {
    provider,
    keyRef,
  };
}

export async function resolveAgentPrivateKey(
  agent: Pick<SpawnedAgent, "id" | "privateKey" | "keyRef">
): Promise<string | null> {
  if (agent.privateKey) {
    const normalized = normalizePrivateKey(agent.privateKey);
    if (normalized) {
      inMemoryPrivateKeys.set(agent.id, normalized);
      return normalized;
    }
  }

  const cached = inMemoryPrivateKeys.get(agent.id);
  if (cached) return cached;

  if (!agent.keyRef) return null;

  if (agent.keyRef.startsWith("memory:")) {
    return inMemoryPrivateKeys.get(agent.id) ?? null;
  }

  const material = await getPersistedAgentKey(agent.id);
  if (!material) return null;

  const decrypted = normalizePrivateKey(await decryptMaterial(material));
  if (!decrypted) return null;
  inMemoryPrivateKeys.set(agent.id, decrypted);
  return decrypted;
}

export async function hydrateAgentAccount(
  agent: Pick<SpawnedAgent, "id" | "walletAddress" | "privateKey" | "keyRef">
): Promise<Account | null> {
  if (!agent.walletAddress) return null;
  const privateKey = await resolveAgentPrivateKey(agent);
  if (!privateKey) return null;
  return new Account({
    provider: localProvider,
    address: agent.walletAddress,
    signer: privateKey,
  });
}

export async function deleteAgentSigningMaterial(agentId: string): Promise<void> {
  inMemoryPrivateKeys.delete(agentId);
  await deletePersistedAgentKey(agentId);
}
