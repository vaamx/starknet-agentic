import { createHash } from "node:crypto";
import { CallData, RpcProvider, stark, typedData as starkTypedData } from "starknet";
import { config } from "./config";
import {
  getPersistedNetworkAuthChallenge,
  markPersistedNetworkAuthChallengeUsed,
  upsertPersistedNetworkAuthChallenge,
  type PersistedNetworkAuthAction,
  type PersistedNetworkAuthChallenge,
} from "./state-store";
import { isStarknetAddress, normalizeWalletAddress } from "./agent-network";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });
const DEFAULT_TTL_SECS = 180;
const MAX_TTL_SECS = 600;
const FIELD_PRIME =
  BigInt("0x800000000000011000000000000000000000000000000000000000000000001");

const AUTH_DOMAIN = {
  name: "StarknetAgenticSwarm",
  version: "1",
  chainId: config.STARKNET_CHAIN_ID,
  revision: "1",
};

const AUTH_TYPES = {
  StarknetDomain: [
    { name: "name", type: "shortstring" },
    { name: "version", type: "shortstring" },
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
  NetworkAuth: [
    { name: "scope", type: "shortstring" },
    { name: "action", type: "shortstring" },
    { name: "challenge_id", type: "felt252" },
    { name: "payload_hash", type: "felt252" },
    { name: "nonce", type: "felt252" },
    { name: "expiry", type: "u64" },
  ],
};

const ACTION_LABELS: Record<PersistedNetworkAuthAction, string> = {
  register_agent: "register",
  update_agent: "update",
  post_contribution: "contrib",
  heartbeat_agent: "heartbeat",
};

export interface NetworkAuthEnvelope {
  challengeId: string;
  walletAddress: string;
  signature: string[];
}

export interface IssuedNetworkAuthChallenge {
  challenge: PersistedNetworkAuthChallenge;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  payloadCanonical: string;
}

type VerifyResult =
  | { ok: true; walletAddress: string; challenge: PersistedNetworkAuthChallenge }
  | { ok: false; status: number; error: string };

function normalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => normalizeForHash(item));

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const next: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    next[key] = normalizeForHash(entryValue);
  }
  return next;
}

function canonicalizePayload(payload: unknown): string {
  return JSON.stringify(normalizeForHash(payload));
}

function hashPayloadToFelt(payload: unknown): { payloadHash: string; payloadCanonical: string } {
  const payloadCanonical = canonicalizePayload(payload);
  const digestHex = createHash("sha256").update(payloadCanonical).digest("hex");
  const digest = BigInt(`0x${digestHex}`) % FIELD_PRIME;
  return {
    payloadHash: `0x${digest.toString(16)}`,
    payloadCanonical,
  };
}

function buildTypedData(challenge: PersistedNetworkAuthChallenge) {
  return {
    domain: AUTH_DOMAIN,
    types: AUTH_TYPES,
    primaryType: "NetworkAuth",
    message: {
      scope: "network",
      action: ACTION_LABELS[challenge.action],
      challenge_id: challenge.id,
      payload_hash: challenge.payloadHash,
      nonce: challenge.nonce,
      expiry: String(challenge.expirySec),
    },
  };
}

export async function issueNetworkAuthChallenge(args: {
  action: PersistedNetworkAuthAction;
  walletAddress: string;
  payload: unknown;
  ttlSecs?: number;
}): Promise<IssuedNetworkAuthChallenge> {
  const walletAddress = normalizeWalletAddress(args.walletAddress);
  if (!isStarknetAddress(walletAddress)) {
    throw new Error("walletAddress must be a valid 0x-prefixed Starknet address");
  }

  const now = Date.now();
  const ttlSecs = Math.max(30, Math.min(MAX_TTL_SECS, args.ttlSecs ?? DEFAULT_TTL_SECS));
  const expiresAt = now + ttlSecs * 1000;
  const expirySec = Math.floor(expiresAt / 1000);
  const challengeId = stark.randomAddress();
  const nonce = stark.randomAddress();
  const { payloadHash, payloadCanonical } = hashPayloadToFelt(args.payload);

  const challenge: PersistedNetworkAuthChallenge = {
    id: challengeId,
    walletAddress,
    action: args.action,
    payloadHash,
    nonce,
    expirySec,
    createdAt: now,
    expiresAt,
  };

  await upsertPersistedNetworkAuthChallenge(challenge);
  return {
    challenge,
    typedData: buildTypedData(challenge),
    payloadCanonical,
  };
}

export async function verifyNetworkAuthEnvelope(args: {
  action: PersistedNetworkAuthAction;
  payload: unknown;
  auth: NetworkAuthEnvelope;
  expectedWalletAddress?: string;
}): Promise<VerifyResult> {
  const challengeId = String(args.auth.challengeId ?? "").trim();
  if (!challengeId) {
    return { ok: false, status: 401, error: "Missing auth challengeId" };
  }

  const walletAddress = normalizeWalletAddress(args.auth.walletAddress ?? "");
  if (!isStarknetAddress(walletAddress)) {
    return {
      ok: false,
      status: 401,
      error: "auth.walletAddress must be a valid 0x-prefixed Starknet address",
    };
  }

  if (args.expectedWalletAddress) {
    const expected = normalizeWalletAddress(args.expectedWalletAddress);
    if (walletAddress !== expected) {
      return {
        ok: false,
        status: 403,
        error: "auth wallet does not match payload wallet",
      };
    }
  }

  const signature = Array.isArray(args.auth.signature) ? args.auth.signature : [];
  if (signature.length === 0) {
    return { ok: false, status: 401, error: "Missing auth signature" };
  }

  const challenge = await getPersistedNetworkAuthChallenge(challengeId);
  if (!challenge) {
    return { ok: false, status: 401, error: "Unknown or expired auth challenge" };
  }
  if (challenge.usedAt) {
    return { ok: false, status: 409, error: "Auth challenge already used" };
  }
  if (challenge.expiresAt < Date.now()) {
    return { ok: false, status: 401, error: "Auth challenge expired" };
  }
  if (challenge.action !== args.action) {
    return { ok: false, status: 403, error: "Auth action does not match this endpoint" };
  }
  if (challenge.walletAddress !== walletAddress) {
    return { ok: false, status: 403, error: "Auth challenge wallet mismatch" };
  }

  const { payloadHash } = hashPayloadToFelt(args.payload);
  if (payloadHash !== challenge.payloadHash) {
    return { ok: false, status: 400, error: "Payload does not match signed challenge" };
  }

  try {
    const typedData = buildTypedData(challenge);
    const msgHash = starkTypedData.getMessageHash(typedData, walletAddress);
    await provider.callContract({
      contractAddress: walletAddress,
      entrypoint: "is_valid_signature",
      calldata: CallData.compile({
        hash: msgHash,
        signatures: signature,
      }),
    });
  } catch {
    return { ok: false, status: 401, error: "Invalid wallet signature" };
  }

  const consumed = await markPersistedNetworkAuthChallengeUsed(challenge.id);
  if (!consumed) {
    return { ok: false, status: 409, error: "Auth challenge already consumed" };
  }

  return { ok: true, walletAddress, challenge };
}
