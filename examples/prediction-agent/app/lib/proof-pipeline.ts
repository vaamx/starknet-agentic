import { createHash, randomUUID } from "node:crypto";
import { RpcProvider } from "starknet";
import { config } from "./config";
import {
  getPersistedProofById,
  getPersistedProofs,
  upsertPersistedProof,
  type PersistedProofAnchor,
  type PersistedProofRecord,
  type PersistedProofVerification,
} from "./state-store";

export type ProofKind =
  | "prediction"
  | "bet"
  | "resolution"
  | "market_creation"
  | "defi_swap"
  | "custom";

export interface CreateProofRecordInput {
  id?: string;
  kind: ProofKind;
  txHash?: string;
  agentId?: string;
  agentName?: string;
  walletAddress?: string;
  marketId?: number;
  question?: string;
  reasoningHash?: string;
  payload?: unknown;
  tags?: Record<string, string>;
  anchor?: boolean;
}

interface AnchorRelayResponse {
  tx_id: string;
  gateway_url?: string;
  data_hash?: string;
}

const proofProvider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

function sortKeys(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sortKeys(item));
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
  }
  return input;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTxHash(txHash: string): string {
  const trimmed = txHash.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

export function getExplorerTxUrl(txHash: string): string {
  const normalized = normalizeTxHash(txHash);
  if (config.STARKNET_CHAIN_ID === "SN_MAIN") {
    return `https://voyager.online/tx/${normalized}`;
  }
  return `https://sepolia.voyager.online/tx/${normalized}`;
}

export async function verifyStarknetTxReceipt(
  txHash: string
): Promise<PersistedProofVerification> {
  const normalized = normalizeTxHash(txHash);
  try {
    const receipt = await proofProvider.getTransactionReceipt(normalized as any);
    const parsed = receipt as any;
    return {
      verified: true,
      executionStatus:
        parsed.execution_status ?? parsed.executionStatus ?? undefined,
      finalityStatus:
        parsed.finality_status ?? parsed.finalityStatus ?? undefined,
      blockNumber:
        typeof parsed.block_number === "number"
          ? parsed.block_number
          : typeof parsed.blockNumber === "number"
            ? parsed.blockNumber
            : undefined,
      blockHash: parsed.block_hash ?? parsed.blockHash ?? undefined,
      verifiedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      verified: false,
      verifiedAt: Date.now(),
      error: err?.message ?? String(err),
    };
  }
}

async function anchorProofToAuditRelay(params: {
  proofId: string;
  payload: string;
  tags: Record<string, string>;
}): Promise<PersistedProofAnchor | null> {
  if (!config.proofAuditRelayUrl || !config.proofAuditRelayApiKey) {
    return null;
  }

  const body = {
    data: Buffer.from(params.payload, "utf8").toString("base64"),
    audit_id: params.proofId,
    model_id: params.tags.agentId ?? "prediction-agent",
    tags: Object.entries(params.tags).map(([name, value]) => ({ name, value })),
  };

  const response = await fetch(
    `${config.proofAuditRelayUrl.replace(/\/$/, "")}/v1/audit/upload`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.proofAuditRelayApiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Audit relay upload failed: HTTP ${response.status} ${text.slice(0, 160)}`
    );
  }

  const payload = (await response.json()) as AnchorRelayResponse;
  if (!payload.tx_id) {
    throw new Error("Audit relay response missing tx_id");
  }

  const gatewayBase = config.proofArweaveGateway.replace(/\/$/, "");
  return {
    provider: "arweave",
    txId: payload.tx_id,
    gatewayUrl:
      payload.gateway_url && payload.gateway_url.length > 0
        ? payload.gateway_url
        : `${gatewayBase}/${payload.tx_id}`,
    dataHash: payload.data_hash ?? "",
    anchoredAt: Date.now(),
  };
}

export async function createProofRecord(
  input: CreateProofRecordInput
): Promise<PersistedProofRecord> {
  const createdAt = Date.now();
  const normalizedPayload = sortKeys(input.payload ?? {});
  const payloadJson = JSON.stringify(normalizedPayload);
  const payloadHash = sha256Hex(payloadJson);

  const txHash = input.txHash ? normalizeTxHash(input.txHash) : undefined;
  const verification = txHash
    ? await verifyStarknetTxReceipt(txHash)
    : undefined;

  const id =
    input.id ??
    `${input.kind}:${txHash ? txHash.toLowerCase() : randomUUID()}`;

  const tags: Record<string, string> = {
    kind: input.kind,
    chainId: config.STARKNET_CHAIN_ID,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.marketId !== undefined ? { marketId: String(input.marketId) } : {}),
    ...(txHash ? { txHash } : {}),
    ...(input.tags ?? {}),
  };

  let anchor: PersistedProofAnchor | undefined;
  if (input.anchor !== false) {
    try {
      anchor = (await anchorProofToAuditRelay({
        proofId: id,
        payload: payloadJson,
        tags,
      })) ?? undefined;
    } catch (err: any) {
      tags.anchorError = err?.message ?? String(err);
    }
  }

  const proof: PersistedProofRecord = {
    id,
    kind: input.kind,
    createdAt,
    updatedAt: createdAt,
    chainId: config.STARKNET_CHAIN_ID,
    txHash,
    explorerUrl: txHash ? getExplorerTxUrl(txHash) : undefined,
    agentId: input.agentId,
    agentName: input.agentName,
    walletAddress: input.walletAddress,
    marketId: input.marketId,
    question: input.question,
    reasoningHash: input.reasoningHash,
    payloadHash,
    payload: payloadJson,
    verification,
    anchor,
    tags,
  };

  await upsertPersistedProof(proof, config.proofPipelineMaxRecords);
  return proof;
}

export async function listProofRecords(limit = 100): Promise<PersistedProofRecord[]> {
  return await getPersistedProofs(limit);
}

export async function getProofRecord(
  id: string
): Promise<PersistedProofRecord | null> {
  return await getPersistedProofById(id);
}

export interface AgentActionProofCandidate {
  type: string;
  txHash?: string;
  agentId?: string;
  agentName?: string;
  marketId?: number;
  question?: string;
  reasoningHash?: string;
  probability?: number;
  betAmount?: string;
  betOutcome?: string;
  resolutionOutcome?: string;
  detail?: string;
}

function mapActionTypeToProofKind(type: string): ProofKind | null {
  if (
    type === "prediction" ||
    type === "bet" ||
    type === "resolution" ||
    type === "market_creation" ||
    type === "defi_swap"
  ) {
    return type;
  }
  return null;
}

export async function recordAgentActionProof(
  action: AgentActionProofCandidate
): Promise<PersistedProofRecord | null> {
  if (!config.proofPipelineAutoEnabled) return null;
  if (!action.txHash) return null;
  const kind = mapActionTypeToProofKind(action.type);
  if (!kind) return null;

  return await createProofRecord({
    id: `${kind}:${normalizeTxHash(action.txHash).toLowerCase()}`,
    kind,
    txHash: action.txHash,
    agentId: action.agentId,
    agentName: action.agentName,
    marketId: action.marketId,
    question: action.question,
    reasoningHash: action.reasoningHash,
    payload: {
      probability: action.probability,
      betAmount: action.betAmount,
      betOutcome: action.betOutcome,
      resolutionOutcome: action.resolutionOutcome,
      detail: action.detail,
    },
    anchor: true,
  });
}

