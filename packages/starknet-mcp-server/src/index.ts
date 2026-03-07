#!/usr/bin/env node

/**
 * Starknet MCP Server
 *
 * Exposes Starknet operations as MCP tools for AI agents.
 * Works with any MCP-compatible client: Claude, ChatGPT, Cursor, OpenClaw.
 *
 * Tools:
 * - starknet_get_balance: Check single token balance
 * - starknet_get_balances: Check multiple token balances (batch, single RPC call)
 * - starknet_transfer: Send tokens
 * - starknet_call_contract: Read contract state
 * - starknet_invoke_contract: Write to contracts
 * - starknet_swap: Execute swaps via avnu
 * - starknet_get_quote: Get swap quotes
 * - starknet_build_calls: Build unsigned calls for external signing (Controller, multisig)
 * - starknet_register_session_key: Register session key on SessionAccount
 * - starknet_revoke_session_key: Revoke a session key
 * - starknet_get_session_data: Read session key data (remaining calls, expiry, etc.)
 * - starknet_build_transfer_calls: Build unsigned ERC-20 transfer calls
 * - starknet_build_swap_calls: Build unsigned AVNU swap calls (approval + route)
 * - starknet_register_agent: Register agent identity (ERC-8004)
 * - starknet_get_agent_info: Read consolidated ERC-8004 identity state
 * - starknet_set_agent_metadata: Set on-chain metadata for an ERC-8004 agent
 * - starknet_update_agent_metadata: Alias for metadata updates
 * - starknet_get_agent_metadata: Read on-chain metadata for an ERC-8004 agent
 * - starknet_get_agent_passport: Read Agent Passport metadata (caps + capability payloads)
 * - starknet_give_feedback: Write feedback to ERC-8004 ReputationRegistry
 * - starknet_get_reputation: Read aggregated feedback summary from ReputationRegistry
 * - starknet_request_validation: Create validation requests in ValidationRegistry
 * - starknet_create_payment_link: Create Starknet payment links
 * - starknet_parse_payment_link: Parse Starknet payment links
 * - starknet_create_invoice: Create stateless payment invoices
 * - starknet_get_invoice_status: Check invoice status and optional fulfillment proof
 * - starknet_generate_qr: Generate payment/address QR payloads (base64)
 * - prediction_get_markets: List prediction markets from a factory contract
 * - prediction_bet: Place a bet on a prediction market (approve + bet multicall)
 * - prediction_record_prediction: Record agent probability on AccuracyTracker
 * - prediction_get_leaderboard: Get agent accuracy leaderboard (Brier scores)
 * - prediction_claim: Claim winnings from a resolved prediction market
 *
 * Usage:
 *   STARKNET_RPC_URL=... STARKNET_ACCOUNT_ADDRESS=... STARKNET_PRIVATE_KEY=... node dist/index.js
 *   STARKNET_RPC_URL=... STARKNET_ACCOUNT_ADDRESS=... STARKNET_SIGNER_MODE=proxy KEYRING_PROXY_URL=... KEYRING_HMAC_SECRET=... node dist/index.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Account,
  RpcProvider,
  PaymasterRpc,
  CallData,
  cairo,
  byteArray,
  shortString,
  ETransactionVersion,
  hash,
  ec,
  num,
  validateAndParseAddress,
  type Call,
} from "starknet";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  resolveTokenAddressAsync,
  validateTokensInputAsync,
} from "./utils.js";
import { getTokenService, configureTokenServiceProvider, TOKENS, STATIC_TOKENS } from "./services/index.js";
import {
  fetchTokenBalance,
  fetchTokenBalances,
} from "./helpers/balance.js";
import {
  getVTokenAddress,
  buildDepositCalls,
  buildWithdrawCalls,
  VESU_PRIME_POOL,
} from "./helpers/vesu.js";
import { uint256 } from "starknet";
import {
  getQuotes,
  quoteToCalls,
  type QuoteRequest,
} from "@avnu/avnu-sdk";
import { z } from "zod";
import { createStarknetPaymentSignatureHeader } from "@starknet-agentic/x402-starknet";
import { formatAmount, formatQuoteFields, formatErrorMessage } from "./utils/formatter.js";
import { PolicyGuard, loadPolicyConfig } from "./middleware/policyGuard.js";
import { KeyringProxySigner } from "./helpers/keyringProxySigner.js";
import { parseDecimalToBigInt } from "./helpers/parseDecimal.js";
import { log } from "./logger.js";

// Environment validation
const envSchema = z.object({
  STARKNET_RPC_URL: z.string().url(),
  STARKNET_ACCOUNT_ADDRESS: z.string().startsWith("0x"),
  STARKNET_SIGNER_MODE: z.enum(["direct", "proxy"]).optional(),
  STARKNET_PRIVATE_KEY: z.string().startsWith("0x").optional(),
  AVNU_BASE_URL: z.string().url().optional(),
  AVNU_PAYMASTER_URL: z.string().url().optional(),
  AVNU_PAYMASTER_API_KEY: z.string().optional(),
  // When AVNU_PAYMASTER_API_KEY is set, some orgs only allow "default" fee mode (user pays in gas token).
  // Allow overriding to avoid hard-failing on sponsored mode.
  AVNU_PAYMASTER_FEE_MODE: z.enum(["sponsored", "default"]).optional(),
  AGENT_ACCOUNT_FACTORY_ADDRESS: z.string().startsWith("0x").optional(),
  ERC8004_IDENTITY_REGISTRY_ADDRESS: z.string().startsWith("0x").optional(),
  ERC8004_REPUTATION_REGISTRY_ADDRESS: z.string().startsWith("0x").optional(),
  ERC8004_VALIDATION_REGISTRY_ADDRESS: z.string().startsWith("0x").optional(),
  KEYRING_PROXY_URL: z.string().url().optional(),
  KEYRING_HMAC_SECRET: z.string().min(1).optional(),
  KEYRING_CLIENT_ID: z.string().min(1).optional(),
  KEYRING_SIGNING_KEY_ID: z.string().min(1).optional(),
  KEYRING_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  KEYRING_SESSION_VALIDITY_SECONDS: z.coerce.number().int().positive().optional(),
  KEYRING_TLS_CLIENT_CERT_PATH: z.string().min(1).optional(),
  KEYRING_TLS_CLIENT_KEY_PATH: z.string().min(1).optional(),
  KEYRING_TLS_CA_PATH: z.string().min(1).optional(),
  NODE_ENV: z.string().optional(),
});

const isSepoliaRpc = (process.env.STARKNET_RPC_URL || "").toLowerCase().includes("sepolia");
const defaultAvnuApiUrl = isSepoliaRpc
  ? "https://sepolia.api.avnu.fi"
  : "https://starknet.api.avnu.fi";
const defaultAvnuPaymasterUrl = isSepoliaRpc
  ? "https://sepolia.paymaster.avnu.fi"
  : "https://starknet.paymaster.avnu.fi";

const env = envSchema.parse({
  STARKNET_RPC_URL: process.env.STARKNET_RPC_URL,
  STARKNET_ACCOUNT_ADDRESS: process.env.STARKNET_ACCOUNT_ADDRESS,
  STARKNET_EXECUTION_SURFACE: process.env.STARKNET_EXECUTION_SURFACE,
  STARKNET_STARKZAP_FALLBACK_TO_DIRECT:
    process.env.STARKNET_STARKZAP_FALLBACK_TO_DIRECT,
  STARKNET_EXECUTION_PROFILE: process.env.STARKNET_EXECUTION_PROFILE,
  STARKNET_SIGNER_MODE: process.env.STARKNET_SIGNER_MODE,
  STARKNET_PRIVATE_KEY: process.env.STARKNET_PRIVATE_KEY,
  AVNU_BASE_URL: process.env.AVNU_BASE_URL || defaultAvnuApiUrl,
  AVNU_PAYMASTER_URL: process.env.AVNU_PAYMASTER_URL || defaultAvnuPaymasterUrl,
  AVNU_PAYMASTER_API_KEY: process.env.AVNU_PAYMASTER_API_KEY,
  AVNU_PAYMASTER_FEE_MODE: process.env.AVNU_PAYMASTER_FEE_MODE as
    | "sponsored"
    | "default"
    | undefined,
  AGENT_ACCOUNT_FACTORY_ADDRESS: process.env.AGENT_ACCOUNT_FACTORY_ADDRESS,
  ERC8004_IDENTITY_REGISTRY_ADDRESS: process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS,
  ERC8004_REPUTATION_REGISTRY_ADDRESS: process.env.ERC8004_REPUTATION_REGISTRY_ADDRESS,
  ERC8004_VALIDATION_REGISTRY_ADDRESS: process.env.ERC8004_VALIDATION_REGISTRY_ADDRESS,
  KEYRING_PROXY_URL: process.env.KEYRING_PROXY_URL,
  KEYRING_HMAC_SECRET: process.env.KEYRING_HMAC_SECRET,
  KEYRING_CLIENT_ID: process.env.KEYRING_CLIENT_ID,
  KEYRING_SIGNING_KEY_ID: process.env.KEYRING_SIGNING_KEY_ID,
  KEYRING_REQUEST_TIMEOUT_MS: process.env.KEYRING_REQUEST_TIMEOUT_MS,
  KEYRING_SESSION_VALIDITY_SECONDS: process.env.KEYRING_SESSION_VALIDITY_SECONDS,
  KEYRING_TLS_CLIENT_CERT_PATH: process.env.KEYRING_TLS_CLIENT_CERT_PATH,
  KEYRING_TLS_CLIENT_KEY_PATH: process.env.KEYRING_TLS_CLIENT_KEY_PATH,
  KEYRING_TLS_CA_PATH: process.env.KEYRING_TLS_CA_PATH,
  NODE_ENV: process.env.NODE_ENV,
});

const executionSurface = env.STARKNET_EXECUTION_SURFACE ?? "direct";
const starkzapFallbackToDirect =
  env.STARKNET_STARKZAP_FALLBACK_TO_DIRECT === "true";
const executionProfile = env.STARKNET_EXECUTION_PROFILE ?? "hardened";
const signerMode = env.STARKNET_SIGNER_MODE ?? "direct";
const runtimeEnvironment = (env.NODE_ENV || "development").toLowerCase();
const isProductionRuntime = runtimeEnvironment === "production";

type ExecuteTransactionToolName =
  | "starknet_transfer"
  | "starknet_invoke_contract"
  | "starknet_vesu_deposit"
  | "starknet_vesu_withdraw"
  | "starknet_swap"
  | "starknet_deploy_agent_account"
  | "starknet_register_agent"
  | "starknet_set_agent_metadata";

const EXECUTE_TRANSACTION_TOOL_NAMES: ExecuteTransactionToolName[] = [
  "starknet_transfer",
  "starknet_invoke_contract",
  "starknet_vesu_deposit",
  "starknet_vesu_withdraw",
  "starknet_swap",
  "starknet_deploy_agent_account",
  "starknet_register_agent",
  "starknet_set_agent_metadata",
];

const HARDENED_STARKZAP_ALLOWED_TOOLS = new Set<ExecuteTransactionToolName>([
  "starknet_transfer",
  "starknet_swap",
]);

if (isProductionRuntime && signerMode !== "proxy") {
  throw new Error(
    "Production mode requires STARKNET_SIGNER_MODE=proxy to prevent in-process private key signing"
  );
}

if (signerMode === "direct" && !env.STARKNET_PRIVATE_KEY) {
  throw new Error("Missing STARKNET_PRIVATE_KEY for STARKNET_SIGNER_MODE=direct");
}

if (signerMode === "proxy") {
  if (!env.KEYRING_PROXY_URL || !env.KEYRING_HMAC_SECRET) {
    throw new Error(
      "Missing keyring proxy configuration for STARKNET_SIGNER_MODE=proxy (KEYRING_PROXY_URL, KEYRING_HMAC_SECRET)"
    );
  }
  if (isProductionRuntime) {
    const proxyUrl = new URL(env.KEYRING_PROXY_URL);
    const isLoopback =
      proxyUrl.hostname === "127.0.0.1" ||
      proxyUrl.hostname === "localhost" ||
      proxyUrl.hostname === "::1" ||
      proxyUrl.hostname === "[::1]";
    if (proxyUrl.protocol !== "https:" && !isLoopback) {
      throw new Error(
        "Production proxy mode requires KEYRING_PROXY_URL to use https unless loopback is used"
      );
    }
    if (!isLoopback) {
      if (
        !env.KEYRING_TLS_CLIENT_CERT_PATH ||
        !env.KEYRING_TLS_CLIENT_KEY_PATH ||
        !env.KEYRING_TLS_CA_PATH
      ) {
        throw new Error(
          "Production proxy mode requires KEYRING_TLS_CLIENT_CERT_PATH, KEYRING_TLS_CLIENT_KEY_PATH, and KEYRING_TLS_CA_PATH for mTLS"
        );
      }
    }
  }
  if (isProductionRuntime && env.STARKNET_PRIVATE_KEY) {
    throw new Error(
      "STARKNET_PRIVATE_KEY must not be set in production when STARKNET_SIGNER_MODE=proxy"
    );
  }
}

// Enforce HTTPS for RPC URL in production to prevent eavesdropping on
// account balances, transaction details, and nonce values.
if (isProductionRuntime) {
  const rpcUrl = new URL(env.STARKNET_RPC_URL);
  const isLoopback =
    rpcUrl.hostname === "127.0.0.1" ||
    rpcUrl.hostname === "localhost" ||
    rpcUrl.hostname === "::1" ||
    rpcUrl.hostname === "[::1]";
  if (rpcUrl.protocol !== "https:" && !isLoopback) {
    throw new Error(
      "Production mode requires STARKNET_RPC_URL to use HTTPS to protect transaction data in transit."
    );
  }
}

// Initialize Starknet provider and account
const provider = new RpcProvider({ nodeUrl: env.STARKNET_RPC_URL, batch: 0 });

// Fee mode:
// - sponsored: dApp pays all gas (requires AVNU paymaster to authorize the API key)
// - default: user pays gas in `gasToken` via paymaster
const paymasterFeeMode =
  env.AVNU_PAYMASTER_FEE_MODE ?? (env.AVNU_PAYMASTER_API_KEY ? "sponsored" : "default");
const isSponsored = paymasterFeeMode === "sponsored" && !!env.AVNU_PAYMASTER_API_KEY;
const paymaster = new PaymasterRpc({
  nodeUrl: env.AVNU_PAYMASTER_URL,
  headers: env.AVNU_PAYMASTER_API_KEY
    ? { "x-paymaster-api-key": env.AVNU_PAYMASTER_API_KEY }
    : {},
});

const accountSigner =
  signerMode === "proxy"
    ? new KeyringProxySigner({
        proxyUrl: env.KEYRING_PROXY_URL!,
        hmacSecret: env.KEYRING_HMAC_SECRET!,
        clientId: env.KEYRING_CLIENT_ID || "starknet-mcp-server",
        accountAddress: env.STARKNET_ACCOUNT_ADDRESS,
        requestTimeoutMs: env.KEYRING_REQUEST_TIMEOUT_MS ?? 5_000,
        sessionValiditySeconds: env.KEYRING_SESSION_VALIDITY_SECONDS ?? 300,
        keyId: env.KEYRING_SIGNING_KEY_ID,
        tlsClientCertPath: env.KEYRING_TLS_CLIENT_CERT_PATH,
        tlsClientKeyPath: env.KEYRING_TLS_CLIENT_KEY_PATH,
        tlsCaPath: env.KEYRING_TLS_CA_PATH,
      })
    : env.STARKNET_PRIVATE_KEY!;

const account = new Account({
  provider,
  address: env.STARKNET_ACCOUNT_ADDRESS,
  signer: accountSigner,
  transactionVersion: ETransactionVersion.V3,
  paymaster,
});

// Initialize TokenService with avnu base URL and RPC provider for on-chain fallback
getTokenService(env.AVNU_BASE_URL);
configureTokenServiceProvider(provider);

// Initialize preflight policy guard
const policyConfig = loadPolicyConfig();
const policyGuard = new PolicyGuard(policyConfig);

function parseFelt(name: string, value: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${name} must be a valid felt`);
  }
  if (parsed < 0n) {
    throw new Error(`${name} must be non-negative`);
  }
  // Starknet felts are field elements; in practice most calldata values should fit in 251 bits.
  // Enforce 251-bit bound to fail fast with a clear error instead of a provider/encoding failure.
  const max251 = (1n << 251n) - 1n;
  if (parsed > max251) {
    throw new Error(`${name} must fit in 251 bits`);
  }
  return parsed;
}

function assertSurfaceSupported(
  toolName: "starknet_transfer" | "starknet_swap" | "starknet_get_quote",
  allowedSurfaces: Array<"direct" | "avnu" | "starkzap">
): void {
  if (allowedSurfaces.includes(executionSurface)) {
    return;
  }
  throw new Error(
    `${toolName} is not supported with STARKNET_EXECUTION_SURFACE=${executionSurface}. ` +
      `Supported surfaces: ${allowedSurfaces.join(", ")}`
  );
}

function parseAddress(name: string, value: string): string {
  try {
    const parsed = validateAndParseAddress(value);
    // Reject the zero address — it's never a valid target for transfers or calls.
    if (/^0x0+$/.test(parsed)) {
      throw new Error("zero address");
    }
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "zero address") {
      throw new Error(`${name} cannot be the zero address.`);
    }
    throw new Error(
      `${name} is not a valid Starknet address: "${value}". ` +
        "Expected a hex string starting with 0x."
    );
  }
}

const MAX_CALLDATA_LEN = 256;

function parseCalldata(name: string, calldata: string[]): string[] {
  if (!Array.isArray(calldata)) {
    throw new Error(`${name} must be an array of felts`);
  }
  if (calldata.length > MAX_CALLDATA_LEN) {
    throw new Error(`${name} too large (max ${MAX_CALLDATA_LEN} items)`);
  }

  return calldata.map((raw, i) => {
    if (typeof raw !== "string") {
      throw new Error(`${name}[${i}] must be a string felt`);
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new Error(`${name}[${i}] must be a valid felt`);
    }
    const felt = parseFelt(`${name}[${i}]`, trimmed);
    return `0x${felt.toString(16)}`;
  });
}

function validateEntrypoint(name: string, value: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required and must be non-empty`);
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${name} contains invalid control characters`);
  }
  return value.trim();
}

// Transaction wait config: ~120 s total (40 retries x 3 s interval).
const TX_WAIT_RETRIES = 40;
const TX_WAIT_INTERVAL_MS = 3_000;

/**
 * Reject an AVNU quote whose server-provided expiry has already passed.
 * The `expiry` field is a Unix-seconds timestamp set by the AVNU router;
 * executing an expired quote will fail on-chain and waste gas.
 */
function assertQuoteNotExpired(quote: { expiry?: number | null }): void {
  if (quote.expiry != null && quote.expiry > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= quote.expiry) {
      throw new Error(
        `Swap quote has expired (expiry=${quote.expiry}, now=${nowSec}). ` +
          "Please request a fresh quote and retry."
      );
    }
  }
}

/** Threshold (5%) above which we flag high price impact to the AI agent. */
const HIGH_PRICE_IMPACT_THRESHOLD = 5;

function priceImpactWarning(priceImpact?: number): string | undefined {
  if (priceImpact != null && Math.abs(priceImpact) >= HIGH_PRICE_IMPACT_THRESHOLD) {
    return (
      `WARNING: Price impact is ${priceImpact.toFixed(2)}% which exceeds the ${HIGH_PRICE_IMPACT_THRESHOLD}% threshold. ` +
      "This swap may result in significant value loss. Consider reducing the amount or using a more liquid pair."
    );
  }
  return undefined;
}

// parseDecimalToBigInt imported from ./helpers/parseDecimal.js

function randomSaltFelt(): string {
  const random = BigInt(`0x${randomBytes(32).toString("hex")}`);
  // Starknet felts are field elements; keep value in 251-bit range.
  return `0x${BigInt.asUintN(251, random).toString(16)}`;
}

const invoicePayloadSchema = z.object({
  v: z.literal(1),
  recipient: z.string().startsWith("0x"),
  token: z.string().min(1),
  tokenAddress: z.string().startsWith("0x"),
  amount: z.string().min(1),
  amountRaw: z.string().regex(/^\d+$/),
  decimals: z.number().int().min(0).max(36),
  memo: z.string().max(256).optional(),
  createdAt: z.number().int().min(0),
  expiresAt: z.number().int().min(0),
});

type InvoicePayload = z.infer<typeof invoicePayloadSchema>;

const registerAgentArgsSchema = z.object({
  token_uri: z.string().optional(),
  gasfree: z.boolean().optional().default(false),
});

const getAgentInfoArgsSchema = z.object({
  agent_id: z.string().min(1, "agent_id is required"),
  metadata_keys: z.array(z.string().min(1)).max(64).optional(),
});

const setAgentMetadataArgsSchema = z.object({
  agent_id: z.string().min(1, "agent_id is required"),
  key: z.string().min(1, "key is required and must be non-empty"),
  value: z.string(),
  gasfree: z.boolean().optional().default(false),
}).refine((value) => value.key !== "agentWallet", {
  message: "'agentWallet' is a reserved key and cannot be set via set_metadata",
  path: ["key"],
});

const giveFeedbackArgsSchema = z.object({
  agent_id: z.string().min(1, "agent_id is required"),
  value: z.union([z.string(), z.number().int(), z.bigint()]),
  value_decimals: z.number().int().min(0).max(255).optional().default(0),
  tag1: z.string().optional().default(""),
  tag2: z.string().optional().default(""),
  endpoint: z.string().optional().default(""),
  feedback_uri: z.string().optional().default(""),
  feedback_hash: z.union([z.string(), z.number().int().nonnegative(), z.bigint().nonnegative()]).optional().default("0"),
  gasfree: z.boolean().optional().default(false),
});

const getReputationArgsSchema = z.object({
  agent_id: z.string().min(1, "agent_id is required"),
  tag1: z.string().optional().default(""),
  tag2: z.string().optional().default(""),
});

const requestValidationArgsSchema = z.object({
  validator_address: z.string().startsWith("0x"),
  agent_id: z.string().min(1, "agent_id is required"),
  request_uri: z.string().trim().min(1, "request_uri is required and must be non-empty"),
  request_hash: z.union([z.string(), z.number().int().nonnegative(), z.bigint().nonnegative()]).optional().default("0"),
  gasfree: z.boolean().optional().default(false),
});

const MAX_INVOICE_ID_LEN = 4096;
const INVOICE_STATUS_WAIT_RETRIES = 3;
const INVOICE_STATUS_WAIT_INTERVAL_MS = 1_000;

function parseToolArgs<T>(schema: z.ZodType<T>, rawArgs: unknown, toolName: string): T {
  const parsed = schema.safeParse(rawArgs ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  throw new Error(`${toolName} input validation failed: ${details}`);
}

function encodeInvoiceId(payload: InvoicePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeInvoiceId(invoiceId: string): InvoicePayload {
  if (!invoiceId || typeof invoiceId !== "string") {
    throw new Error("invoiceId is required");
  }
  if (invoiceId.length > MAX_INVOICE_ID_LEN) {
    throw new Error(`invoiceId is too large (max ${MAX_INVOICE_ID_LEN} chars)`);
  }

  let parsed: unknown;
  try {
    const decoded = Buffer.from(invoiceId, "base64url").toString("utf8");
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("invoiceId is malformed or not valid base64url JSON");
  }

  const payload = invoicePayloadSchema.parse(parsed);
  parseAddress("invoice recipient", payload.recipient);
  parseAddress("invoice tokenAddress", payload.tokenAddress);
  if (payload.expiresAt <= payload.createdAt) {
    throw new Error("invoiceId has invalid timestamps: expiresAt must be greater than createdAt");
  }
  return payload;
}

function buildStarknetPaymentLink(args: {
  address: string;
  amount?: string;
  token?: string;
  memo?: string;
  invoiceId?: string;
}): string {
  const params = new URLSearchParams();
  if (args.amount) params.set("amount", args.amount);
  if (args.token) params.set("token", args.token);
  if (args.memo) params.set("memo", args.memo);
  if (args.invoiceId) params.set("invoice", args.invoiceId);

  const query = params.toString();
  return query.length > 0
    ? `starknet:${args.address}?${query}`
    : `starknet:${args.address}`;
}

function normalizeHex(value: string | undefined): string {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    return `0x${BigInt(prefixed).toString(16)}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function parseErc20TransferEvent(event: {
  keys?: string[];
  data?: string[];
}): { from: string; to: string; amountRaw: bigint } {
  const keys = Array.isArray(event.keys) ? event.keys : [];
  const data = Array.isArray(event.data) ? event.data : [];

  // Standard Starknet ERC-20 event shape:
  // keys = [selector, from, to], data = [amount_low, amount_high]
  if (keys.length >= 3 && data.length >= 2) {
    return {
      from: normalizeHex(keys[1]),
      to: normalizeHex(keys[2]),
      amountRaw: BigInt(data[0]) + (BigInt(data[1]) << 128n),
    };
  }

  // Fallback shape sometimes seen in wrappers:
  // data = [from, to, amount_low, amount_high]
  if (data.length >= 4) {
    return {
      from: normalizeHex(data[0]),
      to: normalizeHex(data[1]),
      amountRaw: BigInt(data[2]) + (BigInt(data[3]) << 128n),
    };
  }

  return { from: "", to: "", amountRaw: 0n };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildQrLikeSvg(content: string): { svg: string; base64: string; dataUrl: string } {
  // Dependency-free fallback: generate a deterministic QR-like matrix SVG from content hash.
  // For strict QR compliance, clients can use `content` with a native QR renderer.
  const size = 29;
  const cell = 8;
  const margin = 4;
  const total = (size + margin * 2) * cell;
  const hashBytes = createHash("sha256").update(content).digest();
  const occupied = new Set<string>();

  const mark = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    occupied.add(`${x},${y}`);
  };

  const drawFinder = (ox: number, oy: number): void => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const isOuter = x === 0 || y === 0 || x === 6 || y === 6;
        const isInner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (isOuter || isInner) {
          mark(ox + x, oy + y);
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  let bitIndex = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder =
        (x < 8 && y < 8) ||
        (x >= size - 8 && y < 8) ||
        (x < 8 && y >= size - 8);
      if (inFinder) continue;

      const byte = hashBytes[bitIndex % hashBytes.length];
      const bit = (byte >> (bitIndex % 8)) & 1;
      const parity = (x + y) % 2;
      if ((bit ^ parity) === 1) {
        mark(x, y);
      }
      bitIndex++;
    }
  }

  const rects = [...occupied]
    .map((coord) => {
      const [xStr, yStr] = coord.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      return `<rect x="${(x + margin) * cell}" y="${(y + margin) * cell}" width="${cell}" height="${cell}" fill="#000"/>`;
    })
    .join("");

  const caption = escapeXml(content.length > 72 ? `${content.slice(0, 69)}...` : content);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total + 44}" viewBox="0 0 ${total} ${total + 44}" role="img" aria-label="Starknet payment QR payload">`,
    `<rect width="${total}" height="${total + 44}" fill="#fff"/>`,
    rects,
    `<text x="${total / 2}" y="${total + 24}" text-anchor="middle" font-family="monospace" font-size="12" fill="#111">starknet payload</text>`,
    `<text x="${total / 2}" y="${total + 38}" text-anchor="middle" font-family="monospace" font-size="10" fill="#555">${caption}</text>`,
    "</svg>",
  ].join("");

  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return {
    svg,
    base64,
    dataUrl: `data:image/svg+xml;base64,${base64}`,
  };
}

function parseDeployResultFromReceipt(
  receipt: unknown,
  factoryAddress: string
): { accountAddress: string | null; agentId: string | null } {
  const events =
    (receipt as { events?: Array<{ from_address?: string; keys?: string[]; data?: string[] }> })
      ?.events;
  if (!events) {
    return { accountAddress: null, agentId: null };
  }

  const factory = factoryAddress.toLowerCase();
  const accountDeployedSelector = hash.getSelectorFromName("AccountDeployed").toLowerCase();
  for (const event of events) {
    const from = event.from_address?.toLowerCase();
    const keys = event.keys;
    const data = event.data;
    if (
      from !== factory ||
      !keys ||
      keys.length < 1 ||
      keys[0]?.toLowerCase() !== accountDeployedSelector ||
      !data ||
      data.length < 4
    ) {
      continue;
    }

    try {
      const accountAddress = data[0];
      const agentIdLow = BigInt(data[2]);
      const agentIdHigh = BigInt(data[3]);
      const agentId = (agentIdLow + (agentIdHigh << 128n)).toString();
      return { accountAddress, agentId };
    } catch {
      continue;
    }
  }

  return { accountAddress: null, agentId: null };
}

/**
 * Execute transaction with optional gasfree mode.
 * - gasfree=false: standard account.execute
 * - gasfree=true + API key: sponsored mode (dApp pays all gas)
 * - gasfree=true + no API key: user pays gas in gasToken
 */
interface ExecuteTransactionResult {
  transactionHash: string;
  configuredSurface: "direct" | "avnu" | "starkzap";
  executedSurface: "direct" | "starkzap";
  fallbackFrom?: "starkzap";
  fallbackReason?: string;
}

function isStarkzapUnavailableError(rawError: unknown): boolean {
  const message =
    typeof rawError === "string"
      ? rawError
      : (rawError as { message?: string } | null)?.message ?? "";
  const lower = message.toLowerCase();
  return (
    lower.includes("starkzap sdk is unavailable") ||
    lower.includes("cannot find module") ||
    lower.includes("incomplete starkzap sdk exports") ||
    lower.includes("requires starknet_signer_mode=direct") ||
    lower.includes("requires starknet_private_key")
  );
}

function normalizeErrorMessage(rawError: unknown): string {
  if (rawError instanceof Error) return rawError.message;
  if (typeof rawError === "string") return rawError;
  return "unknown";
}

async function probeStarkzapReadiness(): Promise<{
  ready: boolean;
  reason?: string;
}> {
  if (signerMode !== "direct") {
    return {
      ready: false,
      reason:
        "starkzap execution requires STARKNET_SIGNER_MODE=direct with STARKNET_PRIVATE_KEY set",
    };
  }

  if (!env.STARKNET_PRIVATE_KEY) {
    return {
      ready: false,
      reason: "starkzap execution requires STARKNET_PRIVATE_KEY",
    };
  }

  const dynamicImport = new Function(
    "moduleName",
    "return import(moduleName)"
  ) as (moduleName: string) => Promise<any>;

  try {
    const sdkModule = await dynamicImport("starkzap");
    if (!sdkModule?.StarkSDK || !sdkModule?.StarkSigner || !sdkModule?.ChainId) {
      return {
        ready: false,
        reason: "Incomplete Starkzap SDK exports (StarkSDK/StarkSigner/ChainId)",
      };
    }
    return { ready: true };
  } catch {
    return {
      ready: false,
      reason:
        'Starkzap SDK is unavailable. Install dependency "starkzap" to enable STARKNET_EXECUTION_SURFACE=starkzap.',
    };
  }
}

async function executeThroughAccount(
  calls: Call | Call[],
  gasfree: boolean,
  gasToken: string = TOKENS.STRK
): Promise<string> {
  if (!gasfree) {
    const result = await account.execute(calls);
    return result.transaction_hash;
  }

  const callsArray = Array.isArray(calls) ? calls : [calls];
  const paymasterDetails = isSponsored
    ? { feeMode: { mode: "sponsored" as const } }
    : { feeMode: { mode: "default" as const, gasToken } };

  // Prefer using starknet.js paymaster API (no unsafe casts).
  // For default fee mode, passing the suggested max fee improves reliability.
  const estimation = await account.estimatePaymasterTransactionFee(callsArray, paymasterDetails);
  const result = await account.executePaymasterTransaction(
    callsArray,
    paymasterDetails,
    estimation.suggested_max_fee_in_gas_token
  );

  return result.transaction_hash;
}

// MCP Server setup — exported so http-server.ts can share this instance
export const server = new Server(
  {
    name: "starknet-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const tools: Tool[] = [
  {
    name: "starknet_get_balance",
    description:
      "Get token balance for an address on Starknet. Supports ETH, STRK, USDC, USDT, or any token address. For multiple tokens, use starknet_get_balances instead.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address to check balance for (defaults to agent's address)",
        },
        token: {
          type: "string",
          description: "Token symbol (ETH, STRK, USDC, USDT) or contract address",
        },
      },
      required: ["token"],
    },
  },
  {
    name: "starknet_get_balances",
    description:
      "Get multiple token balances for an address in a single RPC call. More efficient than calling starknet_get_balance multiple times. Supports ETH, STRK, USDC, USDT, or any token addresses.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address to check balances for (defaults to agent's address)",
        },
        tokens: {
          type: "array",
          items: { type: "string" },
          description: "Array of token symbols (ETH, STRK, USDC, USDT) or contract addresses",
        },
      },
      required: ["tokens"],
    },
  },
  {
    name: "starknet_transfer",
    description: "Transfer tokens to another address on Starknet. Supports gasfree mode where gas is paid in an ERC-20 token instead of ETH/STRK.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "Recipient address (must start with 0x)",
        },
        token: {
          type: "string",
          description: "Token symbol (ETH, STRK, USDC, USDT) or contract address",
        },
        amount: {
          type: "string",
          description: "Amount to transfer in human-readable format (e.g., '1.5' for 1.5 tokens)",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
        gasToken: {
          type: "string",
          description: "Token to pay gas fees in (symbol or address). Only used when gasfree=true and no API key is set.",
        },
      },
      required: ["recipient", "token", "amount"],
    },
  },
  {
    name: "starknet_call_contract",
    description: "Call a read-only contract function on Starknet",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: {
          type: "string",
          description: "Contract address",
        },
        entrypoint: {
          type: "string",
          description: "Function name to call",
        },
        calldata: {
          type: "array",
          items: { type: "string" },
          description: "Function arguments as array of strings",
          default: [],
        },
      },
      required: ["contractAddress", "entrypoint"],
    },
  },
  {
    name: "starknet_invoke_contract",
    description: "Invoke a state-changing contract function on Starknet. Supports gasfree mode where gas is paid in an ERC-20 token instead of ETH/STRK.",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: {
          type: "string",
          description: "Contract address",
        },
        entrypoint: {
          type: "string",
          description: "Function name to call",
        },
        calldata: {
          type: "array",
          items: { type: "string" },
          description: "Function arguments as array of strings",
          default: [],
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
        gasToken: {
          type: "string",
          description: "Token to pay gas fees in (symbol or address). Only used when gasfree=true and no API key is set.",
        },
      },
      required: ["contractAddress", "entrypoint"],
    },
  },
  {
    name: "starknet_swap",
    description:
      "Execute a token swap on Starknet using avnu aggregator for best prices. Supports gasfree mode where gas is paid via paymaster.",
    inputSchema: {
      type: "object",
      properties: {
        sellToken: {
          type: "string",
          description: "Token to sell (symbol or address)",
        },
        buyToken: {
          type: "string",
          description: "Token to buy (symbol or address)",
        },
        amount: {
          type: "string",
          description: "Amount to sell in human-readable format",
        },
        slippage: {
          type: "number",
          description: "Maximum slippage tolerance (0.01 = 1%)",
          default: 0.01,
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
        gasToken: {
          type: "string",
          description: "Token to pay gas fees in (symbol or address). Defaults to sellToken. Only used when gasfree=true and no API key is set.",
        },
      },
      required: ["sellToken", "buyToken", "amount"],
    },
  },
  {
    name: "starknet_get_quote",
    description: "Get swap quote without executing the trade",
    inputSchema: {
      type: "object",
      properties: {
        sellToken: {
          type: "string",
          description: "Token to sell (symbol or address)",
        },
        buyToken: {
          type: "string",
          description: "Token to buy (symbol or address)",
        },
        amount: {
          type: "string",
          description: "Amount to sell in human-readable format",
        },
      },
      required: ["sellToken", "buyToken", "amount"],
    },
  },
  {
    name: "starknet_execution_surface_status",
    description:
      "Report execution-surface readiness, fallback posture, and hardened profile constraints (direct/avnu/starkzap).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "starknet_estimate_fee",
    description: "Estimate transaction fee for a contract call",
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: {
          type: "string",
          description: "Contract address",
        },
        entrypoint: {
          type: "string",
          description: "Function name",
        },
        calldata: {
          type: "array",
          items: { type: "string" },
          description: "Function arguments",
          default: [],
        },
      },
      required: ["contractAddress", "entrypoint"],
    },
  },
  {
    name: "starknet_create_payment_link",
    description:
      "Create a Starknet payment link (starknet:<address>?amount=...&token=...&memo=...). Can optionally embed an invoice id.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Recipient Starknet address (0x-prefixed)",
        },
        amount: {
          type: "string",
          description: "Optional amount in human-readable units (e.g. '0.5')",
        },
        token: {
          type: "string",
          description: "Optional token symbol or token address (defaults to STRK when amount is provided)",
        },
        memo: {
          type: "string",
          description: "Optional memo to include in the link (max 256 chars)",
        },
        invoiceId: {
          type: "string",
          description: "Optional invoice id from starknet_create_invoice",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "starknet_parse_payment_link",
    description:
      "Parse a Starknet payment link and return normalized recipient, token resolution, amount details, and embedded invoice data when present.",
    inputSchema: {
      type: "object",
      properties: {
        paymentLink: {
          type: "string",
          description: "Payment link in starknet:<address>?... format",
        },
      },
      required: ["paymentLink"],
    },
  },
  {
    name: "starknet_create_invoice",
    description:
      "Create a stateless invoice for Starknet payments. Returns an invoice id and payment link. Invoice ids are base64url-encoded payloads (no server-side DB required).",
    inputSchema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "Recipient Starknet address (0x-prefixed)",
        },
        amount: {
          type: "string",
          description: "Required payment amount in human-readable units",
        },
        token: {
          type: "string",
          description: "Token symbol or address (default: USDC)",
          default: "USDC",
        },
        memo: {
          type: "string",
          description: "Optional invoice memo/description (max 256 chars)",
        },
        expiresInSeconds: {
          type: "number",
          description: "Invoice TTL in seconds (min 60, max 604800). Default: 3600 (1h)",
          default: 3600,
        },
      },
      required: ["recipient", "amount"],
    },
  },
  {
    name: "starknet_get_invoice_status",
    description:
      "Decode an invoice id and report status (pending/expired/paid/underpaid/reverted). Optionally verify fulfillment by checking an ERC-20 Transfer event in a provided transaction hash.",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: {
          type: "string",
          description: "Invoice id from starknet_create_invoice",
        },
        transactionHash: {
          type: "string",
          description: "Optional tx hash to verify payment fulfillment",
        },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "starknet_generate_qr",
    description:
      "Generate QR-style payloads (SVG data URL or SVG base64) from raw content or Starknet payment fields (address/amount/token/memo/invoiceId).",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Raw content to encode as QR",
        },
        address: {
          type: "string",
          description: "Recipient address used when content is omitted",
        },
        amount: {
          type: "string",
          description: "Optional amount used when content is omitted",
        },
        token: {
          type: "string",
          description: "Optional token used when content is omitted",
        },
        memo: {
          type: "string",
          description: "Optional memo used when content is omitted",
        },
        invoiceId: {
          type: "string",
          description: "Optional invoice id used when content is omitted",
        },
        format: {
          type: "string",
          enum: ["data_url", "svg"],
          description: "Output format: 'data_url' (SVG data URL) or 'svg' (SVG base64)",
          default: "data_url",
        },
      },
      required: [],
    },
  },
  {
    name: "starknet_vesu_deposit",
    description:
      "Supply assets to Vesu V2 lending pool (ERC-4626). Uses Prime pool by default. Requires approve + deposit. Supports gasfree mode.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token symbol (STRK, ETH, USDC, USDT) or address",
        },
        amount: {
          type: "string",
          description: "Amount to deposit in human-readable format",
        },
        pool: {
          type: "string",
          description: "Vesu pool address. Defaults to Prime pool.",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode",
          default: false,
        },
        gasToken: {
          type: "string",
          description: "Token to pay gas in when gasfree=true",
        },
      },
      required: ["token", "amount"],
    },
  },
  {
    name: "starknet_vesu_withdraw",
    description:
      "Withdraw assets from Vesu V2 lending pool. Withdraws underlying assets (not shares). Supports gasfree mode.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token symbol (STRK, ETH, USDC, USDT) or address",
        },
        amount: {
          type: "string",
          description: "Amount of underlying assets to withdraw",
        },
        pool: {
          type: "string",
          description: "Vesu pool address. Defaults to Prime pool.",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode",
          default: false,
        },
        gasToken: {
          type: "string",
          description: "Token to pay gas in when gasfree=true",
        },
      },
      required: ["token", "amount"],
    },
  },
  {
    name: "starknet_vesu_positions",
    description:
      "Get lending positions (vToken balances and converted assets) for the agent's address in Vesu V2 pools.",
    inputSchema: {
      type: "object",
      properties: {
        tokens: {
          type: "array",
          items: { type: "string" },
          description: "Token symbols (STRK, ETH, USDC, USDT) or addresses to check",
        },
        address: {
          type: "string",
          description: "Address to check (defaults to agent's address)",
        },
        pool: {
          type: "string",
          description: "Vesu pool address. Defaults to Prime pool.",
        },
      },
      required: ["tokens"],
    },
  },
  {
    name: "starknet_build_calls",
    description:
      "Build unsigned Starknet calls without executing. Returns a JSON array of Call objects compatible with starknet.js account.execute() and Cartridge Controller. Use this when you need to compose calls for external signing (e.g., session keys, hardware wallets, multisig).",
    inputSchema: {
      type: "object",
      properties: {
        calls: {
          type: "array",
          description: "Array of call objects to build",
          items: {
            type: "object",
            properties: {
              contractAddress: {
                type: "string",
                description: "Target contract address (0x-prefixed)",
              },
              entrypoint: {
                type: "string",
                description: "Function name to call",
              },
              calldata: {
                type: "array",
                items: { type: "string" },
                description: "Function arguments as array of felt strings",
                default: [],
              },
            },
            required: ["contractAddress", "entrypoint"],
          },
        },
      },
      required: ["calls"],
    },
  },
];

if (signerMode === "direct") {
  tools.push({
    name: "x402_starknet_sign_payment_required",
    description:
      "Sign a base64 PAYMENT-REQUIRED header containing Starknet typedData, return a base64 PAYMENT-SIGNATURE header value.",
    inputSchema: {
      type: "object",
      properties: {
        paymentRequiredHeader: {
          type: "string",
          description: "Base64 JSON from PAYMENT-REQUIRED header",
        },
      },
      required: ["paymentRequiredHeader"],
    },
  });
}

tools.push(
  // ── Session key management tools ────────────────────────────────────
  {
    name: "starknet_register_session_key",
    description:
      "Register a session key on a SessionAccount (chipi-pay fork). Owner-only operation. The session key gets time-limited, call-count-limited access with optional selector whitelist.",
    inputSchema: {
      type: "object",
      properties: {
        accountAddress: {
          type: "string",
          description: "SessionAccount contract address (0x-prefixed)",
        },
        sessionPublicKey: {
          type: "string",
          description: "Public key of the session key to register (felt, 0x-prefixed)",
        },
        validUntil: {
          type: "number",
          description: "Unix timestamp (seconds) when session expires",
        },
        maxCalls: {
          type: "number",
          description: "Maximum number of transactions allowed for this session",
        },
        allowedEntrypoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional array of allowed function selectors (felt strings). Empty = any non-admin selector on external contracts.",
          default: [],
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas)",
          default: false,
        },
      },
      required: ["accountAddress", "sessionPublicKey", "validUntil", "maxCalls"],
    },
  },
  {
    name: "starknet_revoke_session_key",
    description:
      "Revoke a session key from a SessionAccount. Owner-only. Zeroes the session data and clears allowed entrypoints.",
    inputSchema: {
      type: "object",
      properties: {
        accountAddress: {
          type: "string",
          description: "SessionAccount contract address (0x-prefixed)",
        },
        sessionPublicKey: {
          type: "string",
          description: "Public key of the session key to revoke (felt, 0x-prefixed)",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas)",
          default: false,
        },
      },
      required: ["accountAddress", "sessionPublicKey"],
    },
  },
  {
    name: "starknet_get_session_data",
    description:
      "Read session key data from a SessionAccount. Returns valid_until, max_calls, calls_used, and allowed_entrypoints_len.",
    inputSchema: {
      type: "object",
      properties: {
        accountAddress: {
          type: "string",
          description: "SessionAccount contract address (0x-prefixed)",
        },
        sessionPublicKey: {
          type: "string",
          description: "Public key of the session key to query (felt, 0x-prefixed)",
        },
      },
      required: ["accountAddress", "sessionPublicKey"],
    },
  },
  // ── Domain-specific unsigned call builders ──────────────────────────
  {
    name: "starknet_build_transfer_calls",
    description:
      "Build unsigned ERC-20 transfer calls. Returns Call[] for external signing (session key, owner, hardware wallet).",
    inputSchema: {
      type: "object",
      properties: {
        tokenAddress: {
          type: "string",
          description: "ERC-20 token contract address (0x-prefixed), or token symbol like 'ETH', 'STRK', 'USDC'",
        },
        recipientAddress: {
          type: "string",
          description: "Recipient address (0x-prefixed)",
        },
        amount: {
          type: "string",
          description: "Amount to transfer in human-readable units (e.g. '1.5' for 1.5 tokens)",
        },
      },
      required: ["tokenAddress", "recipientAddress", "amount"],
    },
  },
  {
    name: "starknet_build_swap_calls",
    description:
      "Build unsigned swap calls via AVNU. Returns approval + swap Call[] for external signing.",
    inputSchema: {
      type: "object",
      properties: {
        sellTokenAddress: {
          type: "string",
          description: "Token to sell (address or symbol like 'ETH', 'STRK')",
        },
        buyTokenAddress: {
          type: "string",
          description: "Token to buy (address or symbol)",
        },
        sellAmount: {
          type: "string",
          description: "Amount to sell in human-readable units (e.g. '0.1')",
        },
        signerAddress: {
          type: "string",
          description: "Address of the account that will sign and execute (0x-prefixed)",
        },
        slippageBps: {
          type: "number",
          description: "Slippage tolerance in basis points (default: 100 = 1%)",
          default: 100,
        },
      },
      required: ["sellTokenAddress", "buyTokenAddress", "sellAmount", "signerAddress"],
    },
  }
);

if (env.AGENT_ACCOUNT_FACTORY_ADDRESS) {
  tools.push({
    name: "starknet_deploy_agent_account",
    description:
      "Deploy a new agent account via AgentAccountFactory. Requires caller-supplied public_key (no server-side key generation).",
    inputSchema: {
      type: "object",
      properties: {
        public_key: {
          type: "string",
          description: "Stark public key (felt, 0x-prefixed recommended)",
        },
        token_uri: {
          type: "string",
          description: "Token URI to register identity metadata",
        },
        salt: {
          type: "string",
          description: "Optional deploy salt felt. Random if omitted.",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
      },
      required: ["public_key", "token_uri"],
    },
  });
}

if (env.ERC8004_IDENTITY_REGISTRY_ADDRESS) {
  tools.push({
    name: "starknet_register_agent",
    description:
      "Register a new ERC-8004 agent identity in IdentityRegistry. Optionally provide token_uri. Returns tx hash and parsed agent_id (best-effort).",
    inputSchema: {
      type: "object",
      properties: {
        token_uri: {
          type: "string",
          description: "Optional token URI (e.g., ipfs://... or data:application/json;utf8,...)",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
      },
      required: [],
    },
  });

  tools.push({
    name: "starknet_get_agent_info",
    description:
      "Read consolidated ERC-8004 identity state for an agent: existence, owner, wallet, token URI, and selected metadata keys.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Agent ID (u256 decimal or hex string)",
        },
        metadata_keys: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional metadata keys to read. Defaults to common keys: agentName, agentType, version, model, status, framework, capabilities, a2aEndpoint, moltbookId.",
        },
      },
      required: ["agent_id"],
    },
  });

  tools.push({
    name: "starknet_set_agent_metadata",
    description:
      "Set on-chain metadata for an ERC-8004 agent. Caller must be owner or approved for the agent_id. Standard keys: agentName, agentType, version, model, status, framework, capabilities, a2aEndpoint, moltbookId.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Agent ID (u256 decimal or hex string)",
        },
        key: {
          type: "string",
          description:
            "Metadata key (e.g. 'agentName', 'capabilities'). 'agentWallet' is reserved and cannot be set here.",
        },
        value: {
          type: "string",
          description: "Metadata value to store on-chain",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
      },
      required: ["agent_id", "key", "value"],
    },
  });

  tools.push({
    name: "starknet_update_agent_metadata",
    description:
      "Alias for starknet_set_agent_metadata. Updates on-chain metadata for an ERC-8004 agent.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Agent ID (u256 decimal or hex string)",
        },
        key: {
          type: "string",
          description:
            "Metadata key (e.g. 'agentName', 'capabilities'). 'agentWallet' is reserved and cannot be set here.",
        },
        value: {
          type: "string",
          description: "Metadata value to store on-chain",
        },
        gasfree: {
          type: "boolean",
          description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
          default: false,
        },
      },
      required: ["agent_id", "key", "value"],
    },
  });

  tools.push({
    name: "starknet_get_agent_metadata",
    description:
      "Read on-chain metadata for an ERC-8004 agent. Returns the value stored for the given key, or empty string if not set.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Agent ID (u256 decimal or hex string)",
        },
        key: {
          type: "string",
          description: "Metadata key to read (e.g. 'agentName', 'capabilities')",
        },
      },
      required: ["agent_id", "key"],
    },
  });

  tools.push({
    name: "starknet_get_agent_passport",
    description:
      "Read Agent Passport metadata from ERC-8004 IdentityRegistry. Returns caps index, schema id, parsed capability payloads, and parsing issues.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "Agent ID (u256 decimal or hex string)",
        },
      },
      required: ["agent_id"],
    },
  });

  if (env.ERC8004_REPUTATION_REGISTRY_ADDRESS) {
    tools.push({
      name: "starknet_give_feedback",
      description:
        "Write ERC-8004 feedback for an agent in ReputationRegistry. Supports signed values and optional tags/URI/hash for attestation payloads.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent ID (u256 decimal or hex string)",
          },
          value: {
            type: "string",
            description: "Signed feedback value as i128 string (e.g., '85', '-10')",
          },
          value_decimals: {
            type: "number",
            description: "Decimal precision for value (u8, default: 0)",
            default: 0,
          },
          tag1: {
            type: "string",
            description: "Primary feedback tag (optional)",
          },
          tag2: {
            type: "string",
            description: "Secondary feedback tag (optional)",
          },
          endpoint: {
            type: "string",
            description: "Endpoint/context for the feedback (optional)",
          },
          feedback_uri: {
            type: "string",
            description: "URI with detailed feedback content (optional)",
          },
          feedback_hash: {
            type: "string",
            description: "Optional feedback hash (u256 decimal or hex). Defaults to 0.",
          },
          gasfree: {
            type: "boolean",
            description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
            default: false,
          },
        },
        required: ["agent_id", "value"],
      },
    });

    tools.push({
      name: "starknet_get_reputation",
      description:
        "Read ERC-8004 aggregated reputation summary for an agent from ReputationRegistry (count, normalized score, raw score, decimals).",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent ID (u256 decimal or hex string)",
          },
          tag1: {
            type: "string",
            description: "Primary tag filter (optional)",
          },
          tag2: {
            type: "string",
            description: "Secondary tag filter (optional)",
          },
        },
        required: ["agent_id"],
      },
    });
  }

  if (env.ERC8004_VALIDATION_REGISTRY_ADDRESS) {
    tools.push({
      name: "starknet_request_validation",
      description:
        "Create ERC-8004 validation requests in ValidationRegistry for a designated validator and agent.",
      inputSchema: {
        type: "object",
        properties: {
          validator_address: {
            type: "string",
            description: "Validator address that should respond to this request",
          },
          agent_id: {
            type: "string",
            description: "Agent ID (u256 decimal or hex string)",
          },
          request_uri: {
            type: "string",
            description: "URI with validation context/details",
          },
          request_hash: {
            type: "string",
            description: "Optional request hash (u256 decimal or hex). Defaults to 0 for auto-hash behavior.",
          },
          gasfree: {
            type: "boolean",
            description: "Use gasfree mode (paymaster pays gas or gas paid in token)",
            default: false,
          },
        },
        required: ["validator_address", "agent_id", "request_uri"],
      },
    });
  }

  // ── Prediction Market Tools ─────────────────────────────────────────────────
  tools.push(
    {
      name: "prediction_get_markets",
      description:
        "List all prediction markets from the factory contract, including current odds, total pools, and status. Returns market IDs, implied probabilities, and resolution times.",
      inputSchema: {
        type: "object",
        properties: {
          factoryAddress: {
            type: "string",
            description: "MarketFactory contract address (must start with 0x)",
          },
        },
        required: ["factoryAddress"],
      },
    },
    {
      name: "prediction_bet",
      description:
        "Place a bet on a prediction market. Approves collateral spend and calls market.bet() in a single multicall. Outcome 1 = YES, 0 = NO.",
      inputSchema: {
        type: "object",
        properties: {
          marketAddress: { type: "string", description: "Address of the prediction market contract" },
          outcome: { type: "number", enum: [0, 1], description: "Bet outcome: 1 for YES, 0 for NO" },
          amount: { type: "string", description: "Amount to bet in human-readable format (e.g., '100')" },
          collateralToken: { type: "string", description: "Collateral token address or symbol (defaults to STRK)" },
          gasfree: { type: "boolean", description: "Use gasfree mode", default: false },
          gasToken: { type: "string", description: "Token to pay gas fees in (when gasfree=true)" },
        },
        required: ["marketAddress", "outcome", "amount"],
      },
    },
    {
      name: "prediction_record_prediction",
      description:
        "Record an agent's probability prediction on the AccuracyTracker contract. Stored on-chain for Brier score calculation when the market resolves.",
      inputSchema: {
        type: "object",
        properties: {
          trackerAddress: { type: "string", description: "AccuracyTracker contract address" },
          marketId: { type: "number", description: "Market ID to predict on" },
          probability: { type: "number", description: "Predicted probability (0.0 to 1.0, e.g. 0.73 for 73%)" },
          gasfree: { type: "boolean", description: "Use gasfree mode", default: false },
          gasToken: { type: "string", description: "Token to pay gas fees in" },
        },
        required: ["trackerAddress", "marketId", "probability"],
      },
    },
    {
      name: "prediction_get_leaderboard",
      description:
        "Get the agent accuracy leaderboard from the AccuracyTracker contract. Returns Brier scores (lower = better), prediction counts, and rankings.",
      inputSchema: {
        type: "object",
        properties: {
          trackerAddress: { type: "string", description: "AccuracyTracker contract address" },
          marketId: { type: "number", description: "Market ID to get leaderboard for" },
        },
        required: ["trackerAddress", "marketId"],
      },
    },
    {
      name: "prediction_claim",
      description:
        "Claim winnings from a resolved prediction market. The market must be in RESOLVED state and the caller must have bet on the winning outcome.",
      inputSchema: {
        type: "object",
        properties: {
          marketAddress: { type: "string", description: "Address of the resolved prediction market contract" },
          gasfree: { type: "boolean", description: "Use gasfree mode", default: false },
          gasToken: { type: "string", description: "Token to pay gas fees in" },
        },
        required: ["marketAddress"],
      },
    }
  );
}

// ── Research & Huginn Tools ──────────────────────────────────────────────────
tools.push(
  {
    name: "research_web_search",
    description:
      "Search the web for current information using Tavily (AI-synthesized answer) with Brave Search as fallback. Returns an AI-synthesized answer plus ranked snippets. Ideal for news, current events, and fact-checking.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        recency: { type: "string", description: "Recency filter: 'day', 'week', 'month' (optional)", enum: ["day", "week", "month"] },
      },
      required: ["query"],
    },
  },
  {
    name: "research_polymarket",
    description:
      "Fetch prediction market odds from Polymarket Gamma API for a given topic. Returns market questions, implied probabilities, and total pools.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic or question to search for on Polymarket" },
      },
      required: ["query"],
    },
  },
  {
    name: "research_crypto_prices",
    description:
      "Fetch current cryptocurrency prices and 24-hour change from CoinGecko. Returns price in USD and percentage change.",
    inputSchema: {
      type: "object",
      properties: {
        tokens: { type: "string", description: "Comma-separated token names or symbols (e.g. 'ethereum,starknet,bitcoin')" },
      },
      required: ["tokens"],
    },
  },
  {
    name: "research_sports_scores",
    description:
      "Fetch live and recent sports scores and statistics from ESPN. Supports NFL, NBA, MLB, and other major sports.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Sport, team, or game query (e.g. 'NFL Super Bowl', 'Kansas City Chiefs')" },
      },
      required: ["query"],
    },
  },
  {
    name: "huginn_log_thought",
    description:
      "Hash reasoning text with SHA-256 and log the hash on-chain in the Huginn Registry for verifiable AI provenance. Requires HUGINN_REGISTRY_ADDRESS environment variable.",
    inputSchema: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: "The AI reasoning text to hash and log on-chain" },
        agentName: { type: "string", description: "Optional agent name for the log entry" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "huginn_get_thought",
    description:
      "Check whether a thought hash has been logged or proven in the Huginn Registry. Returns proof status and agent ID.",
    inputSchema: {
      type: "object",
      properties: {
        thoughtHash: { type: "string", description: "The 0x-prefixed SHA-256 hash to look up (64 hex chars)" },
        huginnAddress: { type: "string", description: "Huginn Registry contract address (defaults to HUGINN_REGISTRY_ADDRESS env var)" },
      },
      required: ["thoughtHash"],
    },
  },
  {
    name: "prediction_resolve",
    description:
      "Resolve a prediction market by calling resolve() on the market contract and finalizing the outcome on the AccuracyTracker. The market must have passed its resolution time.",
    inputSchema: {
      type: "object",
      properties: {
        marketAddress: { type: "string", description: "Address of the prediction market to resolve" },
        outcome: { type: "number", enum: [0, 1], description: "Winning outcome: 1 = YES, 0 = NO" },
        marketId: { type: "number", description: "Market ID for AccuracyTracker finalization (optional)" },
        trackerAddress: { type: "string", description: "AccuracyTracker address for finalization (defaults to ACCURACY_TRACKER env var)" },
        gasfree: { type: "boolean", description: "Use gasfree mode", default: false },
      },
      required: ["marketAddress", "outcome"],
    },
  },
  {
    name: "prediction_get_market",
    description:
      "Get the current state of a single prediction market: status, implied probabilities, total pool, resolution time.",
    inputSchema: {
      type: "object",
      properties: {
        marketAddress: { type: "string", description: "Address of the prediction market contract" },
      },
      required: ["marketAddress"],
    },
  }
);

// ── ProveWork Task Marketplace Tools ──────────────────────────────────────
tools.push(
  {
    name: "provework_post_task",
    description:
      "Post a new task to the ProveWork TaskEscrow contract with STRK reward. Transfers reward to escrow on posting.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        descriptionHash: { type: "string", description: "felt252 hash of the task description" },
        rewardAmount: { type: "string", description: "Reward amount in human-readable STRK (e.g. '100')" },
        deadline: { type: "number", description: "Unix timestamp deadline for the task" },
        requiredValidators: { type: "number", description: "Number of validators required (1-255)", default: 1 },
        collateralToken: { type: "string", description: "Collateral token address (defaults to STRK)" },
      },
      required: ["escrowAddress", "descriptionHash", "rewardAmount", "deadline"],
    },
  },
  {
    name: "provework_bid_task",
    description:
      "Bid on an open task in the ProveWork TaskEscrow. Only non-posters can bid.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to bid on" },
        bidAmount: { type: "string", description: "Bid amount in human-readable STRK" },
      },
      required: ["escrowAddress", "taskId", "bidAmount"],
    },
  },
  {
    name: "provework_submit_proof",
    description:
      "Submit completion proof for an assigned ProveWork task.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to submit proof for" },
        proofHash: { type: "string", description: "felt252 hash of the completion proof" },
      },
      required: ["escrowAddress", "taskId", "proofHash"],
    },
  },
  {
    name: "provework_approve_task",
    description:
      "Approve a submitted ProveWork task and release escrowed payment to the assignee.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to approve" },
      },
      required: ["escrowAddress", "taskId"],
    },
  },
  {
    name: "provework_get_tasks",
    description:
      "List tasks from the ProveWork TaskEscrow contract with their status, reward, and assignee info.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        limit: { type: "number", description: "Maximum number of tasks to return", default: 20 },
      },
      required: ["escrowAddress"],
    },
  },
  {
    name: "provework_cancel_task",
    description:
      "Cancel an open ProveWork task and refund the escrowed reward to the poster. Only the task poster can cancel.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to cancel" },
      },
      required: ["escrowAddress", "taskId"],
    },
  },
  {
    name: "provework_dispute_task",
    description:
      "Dispute a submitted ProveWork task. Only the task poster can dispute after proof submission.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to dispute" },
        reasonHash: { type: "string", description: "felt252 hash of the dispute reason" },
      },
      required: ["escrowAddress", "taskId", "reasonHash"],
    },
  },
  {
    name: "provework_resolve_dispute",
    description:
      "Resolve a disputed ProveWork task. Only the escrow contract owner can call this. Ruling: 0=AssigneeWins (release), 1=PosterWins (refund), 2=Split (50/50).",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to resolve" },
        ruling: { type: "number", enum: [0, 1, 2], description: "0=AssigneeWins, 1=PosterWins, 2=Split" },
      },
      required: ["escrowAddress", "taskId", "ruling"],
    },
  },
  {
    name: "provework_force_settle",
    description:
      "Force settle a disputed ProveWork task after the 7-day dispute window expires. Either poster or assignee can call. Default: refund to poster.",
    inputSchema: {
      type: "object",
      properties: {
        escrowAddress: { type: "string", description: "TaskEscrow contract address" },
        taskId: { type: "string", description: "Task ID to force settle" },
      },
      required: ["escrowAddress", "taskId"],
    },
  }
);

// ── StarkMint Token Launchpad Tools ───────────────────────────────────────
tools.push(
  {
    name: "starkmint_launch_token",
    description:
      "Launch a new agent token via StarkMintFactory. Deploys token + bonding curve pair. Returns token and curve addresses.",
    inputSchema: {
      type: "object",
      properties: {
        factoryAddress: { type: "string", description: "StarkMintFactory contract address" },
        name: { type: "string", description: "Token name as felt252" },
        symbol: { type: "string", description: "Token symbol as felt252" },
        curveType: { type: "number", enum: [0, 1, 2], description: "Curve type: 0=linear, 1=quadratic, 2=sigmoid" },
        feeBps: { type: "number", description: "Fee in basis points (max 1000 = 10%)", default: 100 },
        agentId: { type: "string", description: "ERC-8004 agent ID to bind this token to" },
      },
      required: ["factoryAddress", "name", "symbol", "curveType", "agentId"],
    },
  },
  {
    name: "starkmint_buy",
    description:
      "Buy agent tokens from a bonding curve. Pays reserve token (STRK) and receives agent tokens.",
    inputSchema: {
      type: "object",
      properties: {
        curveAddress: { type: "string", description: "BondingCurve contract address" },
        amount: { type: "string", description: "Number of agent tokens to buy (human-readable)" },
        reserveToken: { type: "string", description: "Reserve token address (defaults to STRK)" },
      },
      required: ["curveAddress", "amount"],
    },
  },
  {
    name: "starkmint_sell",
    description:
      "Sell agent tokens back to the bonding curve for reserve tokens.",
    inputSchema: {
      type: "object",
      properties: {
        curveAddress: { type: "string", description: "BondingCurve contract address" },
        amount: { type: "string", description: "Number of agent tokens to sell (human-readable)" },
      },
      required: ["curveAddress", "amount"],
    },
  },
  {
    name: "starkmint_get_price",
    description:
      "Get the current buy/sell price for a given amount of agent tokens on a bonding curve.",
    inputSchema: {
      type: "object",
      properties: {
        curveAddress: { type: "string", description: "BondingCurve contract address" },
        amount: { type: "string", description: "Number of tokens to price (human-readable)", default: "1" },
      },
      required: ["curveAddress"],
    },
  },
  {
    name: "starkmint_get_launches",
    description:
      "List all token launches from a StarkMintFactory contract.",
    inputSchema: {
      type: "object",
      properties: {
        factoryAddress: { type: "string", description: "StarkMintFactory contract address" },
        limit: { type: "number", description: "Max launches to return", default: 20 },
      },
      required: ["factoryAddress"],
    },
  }
);

// ── Agent Guilds DAO Tools ────────────────────────────────────────────────
tools.push(
  {
    name: "guild_create",
    description: "Create a new agent guild with a minimum STRK staking requirement.",
    inputSchema: {
      type: "object",
      properties: {
        registryAddress: { type: "string", description: "GuildRegistry contract address" },
        nameHash: { type: "string", description: "felt252 hash of the guild name" },
        minStake: { type: "string", description: "Minimum stake in STRK (human-readable)" },
      },
      required: ["registryAddress", "nameHash", "minStake"],
    },
  },
  {
    name: "guild_join",
    description: "Join an existing guild by staking STRK. Requires ERC-8004 identity.",
    inputSchema: {
      type: "object",
      properties: {
        registryAddress: { type: "string", description: "GuildRegistry contract address" },
        guildId: { type: "string", description: "Guild ID to join" },
        stakeAmount: { type: "string", description: "STRK amount to stake (human-readable)" },
        stakeToken: { type: "string", description: "Stake token address (defaults to STRK)" },
      },
      required: ["registryAddress", "guildId", "stakeAmount"],
    },
  },
  {
    name: "guild_leave",
    description: "Leave a guild and reclaim staked STRK.",
    inputSchema: {
      type: "object",
      properties: {
        registryAddress: { type: "string", description: "GuildRegistry contract address" },
        guildId: { type: "string", description: "Guild ID to leave" },
      },
      required: ["registryAddress", "guildId"],
    },
  },
  {
    name: "guild_propose",
    description: "Create a governance proposal within a guild. Requires guild membership.",
    inputSchema: {
      type: "object",
      properties: {
        daoAddress: { type: "string", description: "GuildDAO contract address" },
        guildId: { type: "string", description: "Guild ID" },
        descriptionHash: { type: "string", description: "felt252 hash of the proposal description" },
        quorum: { type: "string", description: "Minimum total vote weight required" },
        deadline: { type: "number", description: "Unix timestamp voting deadline" },
      },
      required: ["daoAddress", "guildId", "descriptionHash", "quorum", "deadline"],
    },
  },
  {
    name: "guild_vote",
    description: "Vote on a guild proposal. Vote weight is proportional to staked STRK.",
    inputSchema: {
      type: "object",
      properties: {
        daoAddress: { type: "string", description: "GuildDAO contract address" },
        proposalId: { type: "string", description: "Proposal ID to vote on" },
        support: { type: "boolean", description: "true = YES, false = NO" },
      },
      required: ["daoAddress", "proposalId", "support"],
    },
  },
  {
    name: "guild_execute",
    description: "Execute a passed guild proposal after voting period ends.",
    inputSchema: {
      type: "object",
      properties: {
        daoAddress: { type: "string", description: "GuildDAO contract address" },
        proposalId: { type: "string", description: "Proposal ID to execute" },
      },
      required: ["daoAddress", "proposalId"],
    },
  }
);

function parseIdentityRegisteredFromReceipt(
  receipt: unknown,
  identityRegistryAddress: string
): { agentId: string | null } {
  const events =
    (receipt as { events?: Array<{ from_address?: string; keys?: string[]; data?: string[] }> })
      ?.events;
  if (!events) {
    return { agentId: null };
  }

  const identity = identityRegistryAddress.toLowerCase();
  const registeredSelector = hash.getSelectorFromName("Registered").toLowerCase();
  for (const event of events) {
    const from = event.from_address?.toLowerCase();
    const keys = event.keys;
    if (
      from !== identity ||
      !keys ||
      keys.length < 3 ||
      keys[0]?.toLowerCase() !== registeredSelector
    ) {
      continue;
    }

    try {
      // `Registered` has `agent_id` as a #[key] u256 -> two felts in keys[1..2]
      const agentIdLow = BigInt(keys[1]);
      const agentIdHigh = BigInt(keys[2]);
      const agentId = (agentIdLow + (agentIdHigh << 128n)).toString();
      return { agentId };
    } catch {
      continue;
    }
  }

  return { agentId: null };
}

const DEFAULT_AGENT_INFO_METADATA_KEYS = [
  "agentName",
  "agentType",
  "version",
  "model",
  "status",
  "framework",
  "capabilities",
  "a2aEndpoint",
  "moltbookId",
] as const;

function toCallResultArray(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.map((item) => String(item));
  }
  if (result && typeof result === "object" && Array.isArray((result as { result?: unknown[] }).result)) {
    return ((result as { result: unknown[] }).result).map((item) => String(item));
  }
  return [];
}

function decodeByteArrayResult(result: unknown): string {
  const resultArray = toCallResultArray(result);
  const dataLen = Number(resultArray[0] ?? "0");
  if (!Number.isFinite(dataLen) || dataLen < 0) {
    return "";
  }
  return byteArray.stringFromByteArray({
    data: resultArray.slice(1, 1 + dataLen).map((v) => BigInt(v)),
    pending_word: BigInt(resultArray[1 + dataLen] ?? "0"),
    pending_word_len: Number(resultArray[2 + dataLen] ?? "0"),
  });
}

function readAddressFromCallResult(result: unknown): string | null {
  const values = toCallResultArray(result);
  const first = values[0];
  if (!first) {
    return null;
  }

  const raw = first.startsWith("0x") ? first : num.toHex(BigInt(first));
  if (/^0x0+$/i.test(raw)) {
    return "0x0";
  }
  try {
    return validateAndParseAddress(raw);
  } catch {
    return raw;
  }
}

function readBoolFromCallResult(result: unknown): boolean {
  const values = toCallResultArray(result);
  const first = values[0];
  return first ? BigInt(first) !== 0n : false;
}

function parseU256(name: string, value: string | number | bigint): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${name} must be a valid u256`);
  }
  if (parsed < 0n) {
    throw new Error(`${name} must be non-negative`);
  }
  const max = (1n << 256n) - 1n;
  if (parsed > max) {
    throw new Error(`${name} must fit in 256 bits`);
  }
  return parsed;
}

function parseI128(name: string, value: string | number | bigint): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${name} must be a valid i128`);
  }
  const min = -(1n << 127n);
  const max = (1n << 127n) - 1n;
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must fit in i128 range`);
  }
  return parsed;
}

function parseU8(name: string, value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error(`${name} must be an integer between 0 and 255`);
  }
  return parsed;
}

function formatSignedDecimal(raw: string, decimals: number): string {
  if (decimals <= 0) {
    return raw;
  }
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fractional = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fractional ? `.${fractional}` : ""}`;
}

async function readIdentityMetadataValue(args: {
  identityRegistryAddress: string;
  agentId: string;
  key: string;
}): Promise<string> {
  const agentIdBigInt = BigInt(args.agentId);
  const calldata = CallData.compile({
    agent_id: cairo.uint256(agentIdBigInt),
    key: byteArray.byteArrayFromString(args.key),
  });

  const result = await provider.callContract({
    contractAddress: args.identityRegistryAddress,
    entrypoint: "get_metadata",
    calldata,
  });

  return decodeByteArrayResult(result);
}


async function parseAmount(
  amount: string,
  tokenAddress: string
): Promise<bigint> {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(
      `Invalid amount "${amount}". Expected a non-negative decimal number (e.g. "1.5", "100").`
    );
  }

  const tokenService = getTokenService();
  const decimals = await tokenService.getDecimalsAsync(tokenAddress);

  // Handle decimal amounts
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0");
  const amountStr = whole + paddedFraction.slice(0, decimals);

  return BigInt(amountStr);
}

/**
 * Synchronous amount parser for economy tools that always use 18 decimals (STRK).
 * Avoids the async token-service lookup when decimals are known.
 */
function parseAmountSync(amount: string, decimals: number = 18): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(
      `Invalid amount "${amount}". Expected a non-negative decimal number (e.g. "1.5", "100").`
    );
  }
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0");
  const amountStr = whole + paddedFraction.slice(0, decimals);
  return BigInt(amountStr);
}

// ── Zod schemas for economy tools ──────────────────────────────────────
const addressSchema = z.string().min(3).startsWith("0x");
const uint256StringSchema = z.string().regex(/^\d+$/, "Must be a numeric string");
const amountSchema = z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number");
const felt252Schema = z.string().min(1);

const proveworkPostTaskSchema = z.object({
  escrowAddress: addressSchema,
  descriptionHash: felt252Schema,
  rewardAmount: amountSchema,
  deadline: z.number().int().positive(),
  requiredValidators: z.number().int().min(1).max(255).default(1),
  collateralToken: addressSchema.optional(),
});

const proveworkBidTaskSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
  bidAmount: amountSchema,
});

const proveworkSubmitProofSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
  proofHash: felt252Schema,
});

const proveworkApproveTaskSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
});

const proveworkGetTasksSchema = z.object({
  escrowAddress: addressSchema,
  limit: z.number().int().min(1).max(100).default(20),
});

const proveworkCancelTaskSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
});

const proveworkDisputeTaskSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
  reasonHash: felt252Schema,
});

const proveworkResolveDisputeSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
  ruling: z.number().int().min(0).max(2),
});

const proveworkForceSettleSchema = z.object({
  escrowAddress: addressSchema,
  taskId: uint256StringSchema,
});

const starkmintLaunchTokenSchema = z.object({
  factoryAddress: addressSchema,
  name: z.string().min(1).max(31),
  symbol: z.string().min(1).max(31),
  curveType: z.number().int().min(0).max(2),
  feeBps: z.number().int().min(0).max(1000).default(100),
  agentId: uint256StringSchema,
});

const starkmintBuySchema = z.object({
  curveAddress: addressSchema,
  amount: amountSchema,
  reserveToken: addressSchema.optional(),
});

const starkmintSellSchema = z.object({
  curveAddress: addressSchema,
  amount: amountSchema,
});

const starkmintGetPriceSchema = z.object({
  curveAddress: addressSchema,
  amount: amountSchema.default("1"),
});

const starkmintGetLaunchesSchema = z.object({
  factoryAddress: addressSchema,
  limit: z.number().int().min(1).max(100).default(20),
});

const guildCreateSchema = z.object({
  registryAddress: addressSchema,
  nameHash: felt252Schema,
  minStake: amountSchema,
});

const guildJoinSchema = z.object({
  registryAddress: addressSchema,
  guildId: uint256StringSchema,
  stakeAmount: amountSchema,
  stakeToken: addressSchema.optional(),
});

const guildLeaveSchema = z.object({
  registryAddress: addressSchema,
  guildId: uint256StringSchema,
});

const guildProposeSchema = z.object({
  daoAddress: addressSchema,
  guildId: uint256StringSchema,
  descriptionHash: felt252Schema,
  quorum: amountSchema,
  deadline: z.number().int().positive(),
});

const guildVoteSchema = z.object({
  daoAddress: addressSchema,
  proposalId: uint256StringSchema,
  support: z.boolean(),
});

const guildExecuteSchema = z.object({
  daoAddress: addressSchema,
  proposalId: uint256StringSchema,
});

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Preflight policy check (defense-in-depth, before any tool execution)
  const policyResult = policyGuard.evaluate(name, args as Record<string, unknown>);
  if (!policyResult.allowed) {
    const policyMessage = `Policy violation: ${policyResult.reason}`;
    const normalized = normalizeExecutionError(executionSurface, policyMessage);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: true,
            code: normalized.code,
            surface: normalized.surface,
            message: policyMessage,
            tool: name,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  try {
    switch (name) {
      case "starknet_get_balance": {
        const { address = env.STARKNET_ACCOUNT_ADDRESS, token } = args as {
          address?: string;
          token: string;
        };

        const tokenAddress = await resolveTokenAddressAsync(token);
        const { balance, decimals } = await fetchTokenBalance(address, tokenAddress, provider);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                address,
                token,
                tokenAddress,
                balance: formatAmount(balance, decimals),
                raw: balance.toString(),
                decimals,
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_get_balances": {
        const { address = env.STARKNET_ACCOUNT_ADDRESS, tokens } = args as {
          address?: string;
          tokens: string[];
        };

        const tokenAddresses = await validateTokensInputAsync(tokens);
        const { balances, method } = await fetchTokenBalances(address, tokens, tokenAddresses, provider);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                address,
                balances: balances.map((b) => ({
                  token: b.token,
                  tokenAddress: b.tokenAddress,
                  balance: formatAmount(b.balance, b.decimals),
                  raw: b.balance.toString(),
                  decimals: b.decimals,
                })),
                tokensQueried: tokens.length,
                method,
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_transfer": {
        const { recipient, token, amount, gasfree = false, gasToken } = args as {
          recipient: string;
          token: string;
          amount: string;
          gasfree?: boolean;
          gasToken?: string;
        };

        const validatedRecipient = parseAddress("recipient", recipient);
        const tokenAddress = await resolveTokenAddressAsync(token);
        const amountWei = await parseAmount(amount, tokenAddress);
        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;

        const transferCall: Call = {
          contractAddress: tokenAddress,
          entrypoint: "transfer",
          calldata: CallData.compile({
            recipient: validatedRecipient,
            amount: cairo.uint256(amountWei),
          }),
        };

        const transactionHash = await executeTransaction(transferCall, gasfree, gasTokenAddress);
        await provider.waitForTransaction(transactionHash, { retries: TX_WAIT_RETRIES, retryInterval: TX_WAIT_INTERVAL_MS });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                transactionHash: execution.transactionHash,
                recipient,
                token,
                amount,
                gasfree,
                executionSurface: execution.configuredSurface,
                executedSurface: execution.executedSurface,
                ...(execution.fallbackFrom
                  ? {
                      fallbackFrom: execution.fallbackFrom,
                      fallbackReason: execution.fallbackReason,
                    }
                  : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_call_contract": {
        const { contractAddress, entrypoint, calldata = [] } = args as {
          contractAddress: string;
          entrypoint: string;
          calldata?: string[];
        };

        const validatedContractAddress = parseAddress("contractAddress", contractAddress);
        const validatedEntrypoint = validateEntrypoint("entrypoint", entrypoint);
        const validatedCalldata = parseCalldata("calldata", calldata);
        const result = await provider.callContract({
          contractAddress: validatedContractAddress,
          entrypoint: validatedEntrypoint,
          calldata: validatedCalldata,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                result: Array.isArray(result) ? result : (result as Record<string, unknown>).result ?? result,
                contractAddress,
                entrypoint,
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_invoke_contract": {
        const { contractAddress, entrypoint, calldata = [], gasfree = false, gasToken } = args as {
          contractAddress: string;
          entrypoint: string;
          calldata?: string[];
          gasfree?: boolean;
          gasToken?: string;
        };

        const validatedContractAddress = parseAddress("contractAddress", contractAddress);
        const validatedEntrypoint = validateEntrypoint("entrypoint", entrypoint);
        const validatedCalldata = parseCalldata("calldata", calldata);
        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;
        const invokeCall: Call = {
          contractAddress: validatedContractAddress,
          entrypoint: validatedEntrypoint,
          calldata: validatedCalldata,
        };

        const transactionHash = await executeTransaction(invokeCall, gasfree, gasTokenAddress);
        await provider.waitForTransaction(transactionHash, { retries: TX_WAIT_RETRIES, retryInterval: TX_WAIT_INTERVAL_MS });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                transactionHash: execution.transactionHash,
                contractAddress,
                entrypoint,
                gasfree,
                executionSurface: execution.configuredSurface,
                executedSurface: execution.executedSurface,
                ...(execution.fallbackFrom
                  ? {
                      fallbackFrom: execution.fallbackFrom,
                      fallbackReason: execution.fallbackReason,
                    }
                  : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_vesu_deposit": {
        const { token, amount, pool = VESU_PRIME_POOL, gasfree = false, gasToken } = args as {
          token: string;
          amount: string;
          pool?: string;
          gasfree?: boolean;
          gasToken?: string;
        };

        const poolAddress = parseAddress("pool", pool);
        const assetAddress = await resolveTokenAddressAsync(token);
        const amountWei = await parseAmount(amount, assetAddress);
        if (amountWei <= 0n) {
          throw new Error("Amount must be positive");
        }

        const vTokenAddress = await getVTokenAddress(provider, poolAddress, assetAddress);
        const calls = buildDepositCalls(
          assetAddress,
          vTokenAddress,
          amountWei,
          account.address
        );

        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;
        const execution = await executeTransaction(calls, gasfree, gasTokenAddress, {
          toolName: "starknet_vesu_deposit",
        });
        await provider.waitForTransaction(execution.transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                transactionHash: execution.transactionHash,
                token,
                amount,
                pool: pool === VESU_PRIME_POOL ? "prime" : pool,
                executionSurface: execution.configuredSurface,
                executedSurface: execution.executedSurface,
                ...(execution.fallbackFrom
                  ? {
                      fallbackFrom: execution.fallbackFrom,
                      fallbackReason: execution.fallbackReason,
                    }
                  : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_vesu_withdraw": {
        const { token, amount, pool = VESU_PRIME_POOL, gasfree = false, gasToken } = args as {
          token: string;
          amount: string;
          pool?: string;
          gasfree?: boolean;
          gasToken?: string;
        };

        const poolAddress = parseAddress("pool", pool);
        const assetAddress = await resolveTokenAddressAsync(token);
        const amountWei = await parseAmount(amount, assetAddress);
        if (amountWei <= 0n) {
          throw new Error("Amount must be positive");
        }

        const vTokenAddress = await getVTokenAddress(provider, poolAddress, assetAddress);
        const calls = buildWithdrawCalls(
          vTokenAddress,
          amountWei,
          account.address,
          account.address
        );

        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;
        const execution = await executeTransaction(calls, gasfree, gasTokenAddress, {
          toolName: "starknet_vesu_withdraw",
        });
        await provider.waitForTransaction(execution.transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                transactionHash: execution.transactionHash,
                token,
                amount,
                executionSurface: execution.configuredSurface,
                executedSurface: execution.executedSurface,
                ...(execution.fallbackFrom
                  ? {
                      fallbackFrom: execution.fallbackFrom,
                      fallbackReason: execution.fallbackReason,
                    }
                  : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_vesu_positions": {
        const { tokens, address = env.STARKNET_ACCOUNT_ADDRESS, pool = VESU_PRIME_POOL } = args as {
          tokens: string[];
          address?: string;
          pool?: string;
        };

        if (!tokens || tokens.length === 0) {
          throw new Error("At least one token is required");
        }

        const poolAddress = parseAddress("pool", pool);
        const userAddress = parseAddress("address", address);
        const tokenAddresses = await validateTokensInputAsync(tokens);
        const tokenService = getTokenService();

        const positions: Array<{
          token: string;
          tokenAddress: string;
          shares: string;
          assets: string;
          decimals: number;
        }> = [];

        for (let i = 0; i < tokens.length; i++) {
          const assetAddress = tokenAddresses[i];
          const vTokenAddress = await getVTokenAddress(provider, poolAddress, assetAddress);

          const balanceRaw = await provider.callContract({
            contractAddress: vTokenAddress,
            entrypoint: "balance_of",
            calldata: [userAddress],
          });

          const balanceArr = Array.isArray(balanceRaw) ? balanceRaw : (balanceRaw as { result?: string[] }).result ?? [];
          const balanceVal = balanceArr.length >= 2
            ? { low: BigInt(balanceArr[0]), high: BigInt(balanceArr[1] ?? 0) }
            : (balanceRaw as { balance?: { low: bigint; high: bigint } })?.balance ?? { low: 0n, high: 0n };
          const shares = uint256.uint256ToBN(balanceVal);

          let assets = shares;
          if (shares > 0n) {
            const sharesU256 = cairo.uint256(shares);
            const assetsRaw = await provider.callContract({
              contractAddress: vTokenAddress,
              entrypoint: "convert_to_assets",
              calldata: [String(sharesU256.low), String(sharesU256.high)],
            });
            const assetsArr = Array.isArray(assetsRaw) ? assetsRaw : (assetsRaw as { result?: string[] }).result ?? [];
            if (assetsArr.length >= 2) {
              assets = uint256.uint256ToBN({
                low: BigInt(assetsArr[0]),
                high: BigInt(assetsArr[1] ?? 0),
              });
            }
          }

          const decimals = await tokenService.getDecimalsAsync(assetAddress);
          positions.push({
            token: tokens[i],
            tokenAddress: assetAddress,
            shares: formatAmount(shares, decimals),
            assets: formatAmount(assets, decimals),
            decimals,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                address: userAddress,
                pool: pool === VESU_PRIME_POOL ? "prime" : pool,
                positions,
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_swap": {
        const { sellToken, buyToken, amount, slippage = 0.01, gasfree = false, gasToken } = args as {
          sellToken: string;
          buyToken: string;
          amount: string;
          slippage?: number;
          gasfree?: boolean;
          gasToken?: string;
        };

        // Validate slippage is within reasonable bounds
        if (slippage < 0 || slippage > 0.15) {
          throw new Error("Slippage must be between 0 and 0.15 (15%). Recommended: 0.005-0.03.");
        }

        const [sellTokenAddress, buyTokenAddress] = await Promise.all([
          resolveTokenAddressAsync(sellToken),
          resolveTokenAddressAsync(buyToken),
        ]);
        const sellAmount = await parseAmount(amount, sellTokenAddress);

        const quoteParams: QuoteRequest = {
          sellTokenAddress,
          buyTokenAddress,
          sellAmount,
          takerAddress: account.address,
        };

        const quotes = await getQuotes(quoteParams, { baseUrl: env.AVNU_BASE_URL });
        if (!quotes || quotes.length === 0) {
          throw new Error("No quotes available for this swap");
        }

        const bestQuote = quotes[0];
        assertQuoteNotExpired(bestQuote);

        const { calls } = await quoteToCalls({
          quoteId: bestQuote.quoteId,
          takerAddress: account.address,
          slippage,
          executeApprove: true,
        }, { baseUrl: env.AVNU_BASE_URL });

        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : sellTokenAddress;
        const transactionHash = await executeTransaction(calls, gasfree, gasTokenAddress);
        await provider.waitForTransaction(transactionHash, { retries: TX_WAIT_RETRIES, retryInterval: TX_WAIT_INTERVAL_MS });

        const tokenService = getTokenService();
        const buyDecimals = await tokenService.getDecimalsAsync(buyTokenAddress);
        const quoteFields = formatQuoteFields(bestQuote, buyDecimals);

        const swapPriceWarning = priceImpactWarning(bestQuote.priceImpact);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                transactionHash: execution.transactionHash,
                sellToken,
                buyToken,
                sellAmount: amount,
                ...quoteFields,
                buyAmountInUsd: bestQuote.buyAmountInUsd?.toFixed(2),
                slippage,
                gasfree,
                executionSurface: execution.configuredSurface,
                executedSurface: execution.executedSurface,
                ...(execution.fallbackFrom
                  ? {
                      fallbackFrom: execution.fallbackFrom,
                      fallbackReason: execution.fallbackReason,
                    }
                  : {}),
                ...(swapPriceWarning ? { warning: swapPriceWarning } : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_get_quote": {
        assertSurfaceSupported("starknet_get_quote", ["direct", "avnu", "starkzap"]);

        const { sellToken, buyToken, amount } = args as {
          sellToken: string;
          buyToken: string;
          amount: string;
        };

        const [sellTokenAddress, buyTokenAddress] = await Promise.all([
          resolveTokenAddressAsync(sellToken),
          resolveTokenAddressAsync(buyToken),
        ]);
        const sellAmount = await parseAmount(amount, sellTokenAddress);

        const quoteParams: QuoteRequest = {
          sellTokenAddress,
          buyTokenAddress,
          sellAmount,
          takerAddress: account.address,
        };

        const quotes = await getQuotes(quoteParams, { baseUrl: env.AVNU_BASE_URL });
        if (!quotes || quotes.length === 0) {
          throw new Error("No quotes available");
        }

        const bestQuote = quotes[0];

        const tokenService = getTokenService();
        const buyDecimals = await tokenService.getDecimalsAsync(buyTokenAddress);
        const quoteFields = formatQuoteFields(bestQuote, buyDecimals);
        const quotePriceWarning = priceImpactWarning(bestQuote.priceImpact);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                sellToken,
                buyToken,
                sellAmount: amount,
                ...quoteFields,
                sellAmountInUsd: bestQuote.sellAmountInUsd?.toFixed(2),
                buyAmountInUsd: bestQuote.buyAmountInUsd?.toFixed(2),
                quoteId: bestQuote.quoteId,
                executionSurface,
                ...(quotePriceWarning ? { warning: quotePriceWarning } : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_execution_surface_status": {
        const starkzapProbe = await probeStarkzapReadiness();
        const effectiveSurface =
          executionSurface === "starkzap" && !starkzapProbe.ready && starkzapFallbackToDirect
            ? "direct"
            : executionSurface;
        const blockedInHardenedProfile =
          executionSurface === "starkzap" && executionProfile === "hardened"
            ? EXECUTE_TRANSACTION_TOOL_NAMES.filter((toolName) => !toolAllowsStarkzap(toolName))
            : [];

        const issues: string[] = [];
        if (executionSurface === "starkzap" && !starkzapProbe.ready && !starkzapFallbackToDirect) {
          issues.push(starkzapProbe.reason ?? "starkzap is not ready");
        }
        if (executionSurface === "starkzap" && !starkzapProbe.ready && starkzapFallbackToDirect) {
          issues.push(
            `starkzap unavailable; fallback enabled (${starkzapProbe.reason ?? "unknown reason"})`
          );
        }
        if (blockedInHardenedProfile.length > 0) {
          issues.push(
            `hardened profile restricts starkzap execution to: ${[
              ...HARDENED_STARKZAP_ALLOWED_TOOLS,
            ].join(", ")}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  configuredSurface: executionSurface,
                  effectiveSurface,
                  executionProfile,
                  signerMode,
                  fallbackToDirectEnabled: starkzapFallbackToDirect,
                  starkzapPolicy: {
                    allowedTools:
                      executionProfile === "hardened"
                        ? [...HARDENED_STARKZAP_ALLOWED_TOOLS]
                        : "all",
                    blockedTools: blockedInHardenedProfile,
                  },
                  starkzap: {
                    ready: starkzapProbe.ready,
                    ...(starkzapProbe.reason ? { reason: starkzapProbe.reason } : {}),
                  },
                  issues,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_estimate_fee": {
        const { contractAddress, entrypoint, calldata = [] } = args as {
          contractAddress: string;
          entrypoint: string;
          calldata?: string[];
        };

        const validatedContractAddress = parseAddress("contractAddress", contractAddress);
        const validatedEntrypoint = validateEntrypoint("entrypoint", entrypoint);
        const validatedCalldata = parseCalldata("calldata", calldata);
        const fee = await account.estimateInvokeFee({
          contractAddress: validatedContractAddress,
          entrypoint: validatedEntrypoint,
          calldata: validatedCalldata,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                overallFee: formatAmount(BigInt(fee.overall_fee.toString()), 18),
                resourceBounds: fee.resourceBounds,
                unit: fee.unit || "STRK",
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_create_payment_link": {
        const {
          address: rawAddress,
          amount,
          token,
          memo,
          invoiceId,
        } = args as {
          address: string;
          amount?: string;
          token?: string;
          memo?: string;
          invoiceId?: string;
        };

        if (!rawAddress) throw new Error("address is required");
        const address = parseAddress("address", rawAddress);
        if (memo && memo.length > 256) throw new Error("memo must be 256 characters or less");

        let normalizedToken: string | undefined;
        let tokenAddress: string | undefined;
        let amountRaw: string | undefined;
        let decimals: number | undefined;
        const amountTokenInput = token ?? (amount ? "STRK" : undefined);

        if (amountTokenInput) {
          tokenAddress = amountTokenInput.startsWith("0x")
            ? parseAddress("token", amountTokenInput)
            : await resolveTokenAddressAsync(amountTokenInput);
          const tokenService = getTokenService();
          decimals = await tokenService.getDecimalsAsync(tokenAddress);
          normalizedToken = amountTokenInput.startsWith("0x")
            ? (
              STATIC_TOKENS.find((candidate) =>
                candidate.address.toLowerCase() === tokenAddress!.toLowerCase()
              )?.symbol ?? tokenAddress
            )
            : amountTokenInput.toUpperCase();

          if (amount) {
            const parsedAmount = parseDecimalToBigInt(amount, decimals);
            if (parsedAmount <= 0n) throw new Error("amount must be greater than 0");
            amountRaw = parsedAmount.toString();
          }
        } else if (amount) {
          throw new Error("token is required when amount is provided");
        }

        if (invoiceId) {
          decodeInvoiceId(invoiceId);
        }

        const paymentLink = buildStarknetPaymentLink({
          address,
          amount,
          token: normalizedToken,
          memo,
          invoiceId,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  paymentLink,
                  address,
                  amount,
                  amountRaw,
                  token: normalizedToken,
                  tokenAddress,
                  decimals,
                  memo,
                  invoiceId,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_parse_payment_link": {
        const { paymentLink } = args as { paymentLink: string };
        if (!paymentLink || typeof paymentLink !== "string") {
          throw new Error("paymentLink is required");
        }
        if (!paymentLink.toLowerCase().startsWith("starknet:")) {
          throw new Error("paymentLink must start with 'starknet:'");
        }

        const raw = paymentLink.slice("starknet:".length);
        const queryIndex = raw.indexOf("?");
        const addressRaw = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
        const address = parseAddress("address", addressRaw);
        const queryString = queryIndex === -1 ? "" : raw.slice(queryIndex + 1);
        const params = new URLSearchParams(queryString);

        const amount = params.get("amount") || undefined;
        const memo = params.get("memo") || undefined;
        const invoiceId = params.get("invoice") || undefined;
        const tokenInput = params.get("token") || undefined;

        let tokenAddress: string | undefined;
        let token: string | undefined;
        let amountRaw: string | undefined;
        let decimals: number | undefined;

        if (tokenInput) {
          tokenAddress = tokenInput.startsWith("0x")
            ? parseAddress("token", tokenInput)
            : await resolveTokenAddressAsync(tokenInput);
          const tokenService = getTokenService();
          decimals = await tokenService.getDecimalsAsync(tokenAddress);
          token = tokenInput.startsWith("0x")
            ? (
              STATIC_TOKENS.find((candidate) =>
                candidate.address.toLowerCase() === tokenAddress!.toLowerCase()
              )?.symbol ?? tokenAddress
            )
            : tokenInput.toUpperCase();
        }

        if (amount && decimals !== undefined) {
          const parsedAmount = parseDecimalToBigInt(amount, decimals);
          if (parsedAmount <= 0n) throw new Error("amount must be greater than 0");
          amountRaw = parsedAmount.toString();
        }

        let invoice: InvoicePayload | undefined;
        if (invoiceId) {
          invoice = decodeInvoiceId(invoiceId);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  scheme: "starknet",
                  address,
                  amount,
                  amountRaw,
                  token,
                  tokenAddress,
                  decimals,
                  memo,
                  invoiceId,
                  invoice,
                  rawQuery: queryString,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_create_invoice": {
        const {
          recipient: rawRecipient,
          amount,
          token = "USDC",
          memo,
          expiresInSeconds = 3600,
        } = args as {
          recipient: string;
          amount: string;
          token?: string;
          memo?: string;
          expiresInSeconds?: number;
        };

        if (!rawRecipient) throw new Error("recipient is required");
        if (!amount || typeof amount !== "string") throw new Error("amount is required");
        if (memo && memo.length > 256) throw new Error("memo must be 256 characters or less");
        if (!Number.isFinite(expiresInSeconds)) {
          throw new Error("expiresInSeconds must be a finite number");
        }
        if (expiresInSeconds < 60 || expiresInSeconds > 604_800) {
          throw new Error("expiresInSeconds must be between 60 and 604800");
        }

        const recipient = parseAddress("recipient", rawRecipient);
        const tokenAddress = token.startsWith("0x")
          ? parseAddress("token", token)
          : await resolveTokenAddressAsync(token);
        const tokenService = getTokenService();
        const decimals = await tokenService.getDecimalsAsync(tokenAddress);
        const amountRawBigInt = parseDecimalToBigInt(amount, decimals);
        if (amountRawBigInt <= 0n) {
          throw new Error("amount must be greater than 0");
        }

        const normalizedToken = token.startsWith("0x")
          ? (
            STATIC_TOKENS.find((candidate) =>
              candidate.address.toLowerCase() === tokenAddress.toLowerCase()
            )?.symbol ?? tokenAddress
          )
          : token.toUpperCase();

        const createdAt = Math.floor(Date.now() / 1000);
        const expiresAt = createdAt + Math.floor(expiresInSeconds);

        const payload: InvoicePayload = {
          v: 1,
          recipient,
          token: normalizedToken,
          tokenAddress,
          amount,
          amountRaw: amountRawBigInt.toString(),
          decimals,
          memo,
          createdAt,
          expiresAt,
        };
        const invoiceId = encodeInvoiceId(payload);
        const paymentLink = buildStarknetPaymentLink({
          address: recipient,
          amount,
          token: normalizedToken,
          memo,
          invoiceId,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  invoiceId,
                  status: "pending",
                  recipient,
                  amount,
                  amountRaw: payload.amountRaw,
                  token: normalizedToken,
                  tokenAddress,
                  decimals,
                  memo,
                  createdAt,
                  expiresAt,
                  ttlSeconds: Math.floor(expiresInSeconds),
                  paymentLink,
                  note: "Invoice ids are stateless base64url payloads; store invoiceId externally if you need persistence across sessions.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_get_invoice_status": {
        const { invoiceId, transactionHash } = args as {
          invoiceId: string;
          transactionHash?: string;
        };

        const payload = decodeInvoiceId(invoiceId);
        const now = Math.floor(Date.now() / 1000);
        const initiallyExpired = now > payload.expiresAt;
        let status: "pending" | "expired" | "paid" | "underpaid" | "reverted" =
          initiallyExpired ? "expired" : "pending";
        let paidAfterExpiry = false;

        const paymentLink = buildStarknetPaymentLink({
          address: payload.recipient,
          amount: payload.amount,
          token: payload.token,
          memo: payload.memo,
          invoiceId,
        });

        const verification: {
          transactionHash?: string;
          executionStatus?: string;
          matchedTransferCount?: number;
          paidAmountRaw?: string;
          requiredAmountRaw?: string;
          reason?: string;
        } = {};

        if (transactionHash) {
          verification.transactionHash = transactionHash;
          try {
            const receipt = await provider.waitForTransaction(transactionHash, {
              retries: INVOICE_STATUS_WAIT_RETRIES,
              retryInterval: INVOICE_STATUS_WAIT_INTERVAL_MS,
            });

            const executionStatus =
              ((receipt as { execution_status?: string }).execution_status ??
                (receipt as { finality_status?: string }).finality_status ??
                "UNKNOWN").toString();
            verification.executionStatus = executionStatus;
            if (/REVERT/i.test(executionStatus)) {
              status = "reverted";
            } else {
              const transferSelector = hash.getSelectorFromName("Transfer").toLowerCase();
              const tokenAddress = normalizeHex(payload.tokenAddress);
              const recipient = normalizeHex(payload.recipient);
              const events =
                (receipt as {
                  events?: Array<{ from_address?: string; keys?: string[]; data?: string[] }>;
                }).events ?? [];

              const matched = events
                .filter((event) => {
                  const selector = event.keys?.[0]?.toLowerCase();
                  if (selector !== transferSelector) return false;
                  if (normalizeHex(event.from_address) !== tokenAddress) return false;
                  const transfer = parseErc20TransferEvent({
                    keys: event.keys,
                    data: event.data,
                  });
                  return transfer.to === recipient;
                })
                .map((event) => parseErc20TransferEvent({
                  keys: event.keys,
                  data: event.data,
                }));

              const paidAmountRaw = matched.reduce((acc, transfer) => acc + transfer.amountRaw, 0n);
              const requiredAmountRaw = BigInt(payload.amountRaw);
              verification.matchedTransferCount = matched.length;
              verification.paidAmountRaw = paidAmountRaw.toString();
              verification.requiredAmountRaw = requiredAmountRaw.toString();

              if (paidAmountRaw >= requiredAmountRaw) {
                status = "paid";
                paidAfterExpiry = initiallyExpired;
              } else if (paidAmountRaw > 0n) {
                status = "underpaid";
              }
            }
          } catch (error) {
            verification.reason =
              error instanceof Error ? error.message : "Unable to verify transaction";
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  invoiceId,
                  status,
                  paidAfterExpiry: status === "paid" ? paidAfterExpiry : undefined,
                  recipient: payload.recipient,
                  amount: payload.amount,
                  amountRaw: payload.amountRaw,
                  token: payload.token,
                  tokenAddress: payload.tokenAddress,
                  decimals: payload.decimals,
                  memo: payload.memo,
                  createdAt: payload.createdAt,
                  expiresAt: payload.expiresAt,
                  now,
                  expired: now > payload.expiresAt,
                  paymentLink,
                  verification: Object.keys(verification).length > 0 ? verification : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_generate_qr": {
        const {
          content,
          address: rawAddress,
          amount,
          token,
          memo,
          invoiceId,
          format = "data_url",
        } = args as {
          content?: string;
          address?: string;
          amount?: string;
          token?: string;
          memo?: string;
          invoiceId?: string;
          format?: "data_url" | "svg";
        };

        if (memo && memo.length > 256) throw new Error("memo must be 256 characters or less");
        if (invoiceId) {
          decodeInvoiceId(invoiceId);
        }

        let qrContent = content;
        if (!qrContent) {
          if (!rawAddress) {
            throw new Error("Either content or address is required");
          }
          const address = parseAddress("address", rawAddress);
          const normalizedToken = token?.startsWith("0x") ? parseAddress("token", token) : token;
          qrContent = buildStarknetPaymentLink({
            address,
            amount,
            token: normalizedToken,
            memo,
            invoiceId,
          });
        }

        if (format === "svg") {
          const qr = buildQrLikeSvg(qrContent);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    content: qrContent,
                    format: "svg",
                    mimeType: "image/svg+xml",
                    qrBase64: qr.base64,
                    note: "Deterministic SVG QR-style payload. For strict QR interoperability, render `content` with a QR library in your client.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const qr = buildQrLikeSvg(qrContent);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  content: qrContent,
                  format: "data_url",
                  mimeType: "image/svg+xml",
                  dataUrl: qr.dataUrl,
                  qrBase64: qr.base64,
                  note: "Deterministic SVG QR-style payload. For strict QR interoperability, render `content` with a QR library in your client.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_build_calls": {
        const { calls: rawCalls } = args as {
          calls: Array<{
            contractAddress: string;
            entrypoint: string;
            calldata?: string[];
          }>;
        };

        if (!rawCalls || rawCalls.length === 0) {
          throw new Error("calls array is required and must not be empty");
        }

        if (rawCalls.length > MAX_CALLDATA_LEN) {
          throw new Error(`Too many calls (${rawCalls.length}). Maximum: ${MAX_CALLDATA_LEN}`);
        }

        const validatedCalls = rawCalls.map((call, i) => {
          if (!call.contractAddress) {
            throw new Error(`calls[${i}].contractAddress is required`);
          }
          if (!call.entrypoint) {
            throw new Error(`calls[${i}].entrypoint is required`);
          }
          if (call.calldata && call.calldata.length > MAX_CALLDATA_LEN) {
            throw new Error(`calls[${i}].calldata too large (${call.calldata.length} items, max ${MAX_CALLDATA_LEN})`);
          }
          const validatedAddress = parseAddress(`calls[${i}].contractAddress`, call.contractAddress);
          const validatedEntrypoint = validateEntrypoint(`calls[${i}].entrypoint`, call.entrypoint);
          const validatedCalldata = call.calldata && call.calldata.length > 0
            ? parseCalldata(`calls[${i}].calldata`, call.calldata)
            : [];

          return {
            contractAddress: validatedAddress,
            entrypoint: validatedEntrypoint,
            calldata: validatedCalldata,
          };
        });

        // Detect exact-duplicate calls — likely an LLM hallucination or copy-paste error.
        const callKeys = validatedCalls.map(
          (c) => `${c.contractAddress}:${c.entrypoint}:${c.calldata.join(",")}`
        );
        const seen = new Set<string>();
        const duplicateIndices: number[] = [];
        for (let idx = 0; idx < callKeys.length; idx++) {
          if (seen.has(callKeys[idx])) duplicateIndices.push(idx);
          seen.add(callKeys[idx]);
        }

        const warning =
          duplicateIndices.length > 0
            ? `WARNING: Identical calls detected at indices [${duplicateIndices.join(", ")}]. ` +
              "This may indicate a duplicate request. Review carefully before signing."
            : undefined;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  calls: validatedCalls,
                  callCount: validatedCalls.length,
                  ...(warning ? { warning } : {}),
                  note: "Unsigned calls. Pass to account.execute(calls) or write to calls.json for external signing.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── Session key management handlers ────────────────────────────────
      case "starknet_register_session_key": {
        const {
          accountAddress: rawAccountAddr,
          sessionPublicKey: rawSessionKey,
          validUntil,
          maxCalls,
          allowedEntrypoints: rawEntrypoints = [],
          gasfree = false,
        } = args as {
          accountAddress: string;
          sessionPublicKey: string;
          validUntil: number;
          maxCalls: number;
          allowedEntrypoints?: string[];
          gasfree?: boolean;
        };

        const sessionAccountAddr = parseAddress("accountAddress", rawAccountAddr);
        const sessionKey = parseFelt("sessionPublicKey", rawSessionKey);

        const configuredAccount = parseAddress("STARKNET_ACCOUNT_ADDRESS", env.STARKNET_ACCOUNT_ADDRESS);
        if (sessionAccountAddr.toLowerCase() !== configuredAccount.toLowerCase()) {
          throw new Error(
            `accountAddress (${sessionAccountAddr}) does not match the configured MCP server account (${configuredAccount}). ` +
            `Session key operations can only target the server's own account.`
          );
        }

        const nowSec = Math.floor(Date.now() / 1000);
        if (validUntil <= nowSec) {
          throw new Error("validUntil must be in the future");
        }
        const MAX_SESSION_DURATION_SECS = 30 * 24 * 60 * 60; // 30 days
        if (validUntil > nowSec + MAX_SESSION_DURATION_SECS) {
          throw new Error(
            `validUntil is too far in the future (max 30 days from now). ` +
            `Max allowed: ${nowSec + MAX_SESSION_DURATION_SECS}, got: ${validUntil}`
          );
        }
        if (maxCalls <= 0 || maxCalls > 1_000_000) {
          throw new Error("maxCalls must be between 1 and 1,000,000");
        }

        // Validate session public key is non-zero and in valid range
        if (sessionKey === 0n) {
          throw new Error(
            "sessionPublicKey must be non-zero. A zero key creates an unusable session."
          );
        }
        // Stark curve order: keys must be < CURVE_ORDER
        const STARK_CURVE_ORDER = BigInt("0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f");
        if (sessionKey >= STARK_CURVE_ORDER) {
          throw new Error(
            "sessionPublicKey exceeds Stark curve order. This is not a valid public key."
          );
        }

        // Validate entrypoints (optional: function selectors as felt strings)
        const entrypoints = rawEntrypoints.map((ep, i) => {
          // Allow selector names like "transfer" or hex felts
          if (ep.startsWith("0x")) {
            return parseFelt(`allowedEntrypoints[${i}]`, ep).toString();
          }
          // Convert function name to selector
          return hash.getSelectorFromName(ep);
        });

        const registerCall: Call = {
          contractAddress: sessionAccountAddr,
          entrypoint: "add_or_update_session_key",
          calldata: CallData.compile({
            session_key: `0x${sessionKey.toString(16)}`,
            valid_until: validUntil,
            max_calls: maxCalls,
            allowed_entrypoints: entrypoints,
          }),
        };

        const executeFn = gasfree && isSponsored
          ? () => account.execute([registerCall], { version: ETransactionVersion.V3 })
          : () => account.execute([registerCall]);

        const result = await executeFn();
        await provider.waitForTransaction(result.transaction_hash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  transactionHash: result.transaction_hash,
                  accountAddress: sessionAccountAddr,
                  sessionPublicKey: `0x${sessionKey.toString(16)}`,
                  validUntil,
                  maxCalls,
                  allowedEntrypoints: entrypoints,
                  note: "Session key registered. The session key holder can now sign transactions within these constraints.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_revoke_session_key": {
        const {
          accountAddress: rawAccountAddr,
          sessionPublicKey: rawSessionKey,
          gasfree = false,
        } = args as {
          accountAddress: string;
          sessionPublicKey: string;
          gasfree?: boolean;
        };

        const sessionAccountAddr = parseAddress("accountAddress", rawAccountAddr);
        const sessionKey = parseFelt("sessionPublicKey", rawSessionKey);

        const configuredAccountRevoke = parseAddress("STARKNET_ACCOUNT_ADDRESS", env.STARKNET_ACCOUNT_ADDRESS);
        if (sessionAccountAddr.toLowerCase() !== configuredAccountRevoke.toLowerCase()) {
          throw new Error(
            `accountAddress (${sessionAccountAddr}) does not match the configured MCP server account (${configuredAccountRevoke}). ` +
            `Session key operations can only target the server's own account.`
          );
        }

        const revokeCall: Call = {
          contractAddress: sessionAccountAddr,
          entrypoint: "revoke_session_key",
          calldata: CallData.compile({
            session_key: `0x${sessionKey.toString(16)}`,
          }),
        };

        const executeFn = gasfree && isSponsored
          ? () => account.execute([revokeCall], { version: ETransactionVersion.V3 })
          : () => account.execute([revokeCall]);

        const result = await executeFn();
        await provider.waitForTransaction(result.transaction_hash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  transactionHash: result.transaction_hash,
                  accountAddress: sessionAccountAddr,
                  sessionPublicKey: `0x${sessionKey.toString(16)}`,
                  note: "Session key revoked. It can no longer sign transactions.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_get_session_data": {
        const {
          accountAddress: rawAccountAddr,
          sessionPublicKey: rawSessionKey,
        } = args as {
          accountAddress: string;
          sessionPublicKey: string;
        };

        const sessionAccountAddr = parseAddress("accountAddress", rawAccountAddr);
        const sessionKey = parseFelt("sessionPublicKey", rawSessionKey);

        const sessionData = await provider.callContract({
          contractAddress: sessionAccountAddr,
          entrypoint: "get_session_data",
          calldata: CallData.compile({
            session_key: `0x${sessionKey.toString(16)}`,
          }),
        });

        // SessionData struct: valid_until (u64), max_calls (u32), calls_used (u32), allowed_entrypoints_len (u32)
        // SessionData struct: valid_until (u64), max_calls (u32), calls_used (u32), allowed_entrypoints_len (u32)
        const validUntil = Number(sessionData[0]);
        const maxCalls = Number(sessionData[1]);
        const callsUsed = Number(sessionData[2]);
        const allowedEntrypointsLen = Number(sessionData[3]);

        const isActive = validUntil > 0 && validUntil > Math.floor(Date.now() / 1000) && callsUsed < maxCalls;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  accountAddress: sessionAccountAddr,
                  sessionPublicKey: `0x${sessionKey.toString(16)}`,
                  validUntil,
                  validUntilISO: validUntil > 0 ? new Date(validUntil * 1000).toISOString() : null,
                  maxCalls,
                  callsUsed,
                  callsRemaining: Math.max(0, maxCalls - callsUsed),
                  allowedEntrypointsLen,
                  isActive,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── Domain-specific unsigned call builders ──────────────────────────
      case "starknet_build_transfer_calls": {
        const {
          tokenAddress: rawToken,
          recipientAddress: rawRecipient,
          amount: rawAmount,
        } = args as {
          tokenAddress: string;
          recipientAddress: string;
          amount: string;
        };

        // Resolve token symbol to address if needed
        const tokenAddress = rawToken.startsWith("0x")
          ? parseAddress("tokenAddress", rawToken)
          : await resolveTokenAddressAsync(rawToken);

        const recipientAddress = parseAddress("recipientAddress", rawRecipient);

        // Look up token decimals for human-readable amount conversion
        const tokenService = getTokenService();
        const decimals = await tokenService.getDecimalsAsync(tokenAddress);
        const tokenSymbol = STATIC_TOKENS.find(
          (t) => t.address.toLowerCase() === tokenAddress.toLowerCase()
        )?.symbol ?? tokenAddress;

        const amountBigInt = parseDecimalToBigInt(rawAmount, decimals);

        // ERC-20 transfer: transfer(recipient, amount_u256_low, amount_u256_high)
        const calls: Call[] = [
          {
            contractAddress: tokenAddress,
            entrypoint: "transfer",
            calldata: CallData.compile({
              recipient: recipientAddress,
              amount: cairo.uint256(amountBigInt),
            }),
          },
        ];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  calls,
                  callCount: calls.length,
                  token: tokenSymbol,
                  amount: rawAmount,
                  recipient: recipientAddress,
                  note: "Unsigned transfer call. Pass to account.execute(calls) with session key or owner signature.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_build_swap_calls": {
        const {
          sellTokenAddress: rawSellToken,
          buyTokenAddress: rawBuyToken,
          sellAmount: rawSellAmount,
          signerAddress: rawSigner,
          slippageBps = 100,
        } = args as {
          sellTokenAddress: string;
          buyTokenAddress: string;
          sellAmount: string;
          signerAddress: string;
          slippageBps?: number;
        };

        // Validate slippage bounds (1500 bps = 15% max)
        if (slippageBps < 0 || slippageBps > 1500) {
          throw new Error("slippageBps must be between 0 and 1500 (15%). Recommended: 50-300.");
        }

        const sellTokenAddress = rawSellToken.startsWith("0x")
          ? parseAddress("sellTokenAddress", rawSellToken)
          : await resolveTokenAddressAsync(rawSellToken);

        const buyTokenAddress = rawBuyToken.startsWith("0x")
          ? parseAddress("buyTokenAddress", rawBuyToken)
          : await resolveTokenAddressAsync(rawBuyToken);

        const signerAddress = parseAddress("signerAddress", rawSigner);

        const swapTokenService = getTokenService();
        const sellDecimals = await swapTokenService.getDecimalsAsync(sellTokenAddress);
        const sellAmountBigInt = parseDecimalToBigInt(rawSellAmount, sellDecimals);

        // Get quote from AVNU
        const quoteRequest: QuoteRequest = {
          sellTokenAddress,
          buyTokenAddress,
          sellAmount: sellAmountBigInt,
          takerAddress: signerAddress,
        };

        const quotes = await getQuotes(quoteRequest, { baseUrl: env.AVNU_BASE_URL });
        if (!quotes || quotes.length === 0) {
          throw new Error("No swap quotes available for this pair/amount");
        }

        const bestQuote = quotes[0];
        assertQuoteNotExpired(bestQuote);
        const slippage = slippageBps / 10000;

        const { calls: swapCalls } = await quoteToCalls({
          quoteId: bestQuote.quoteId,
          takerAddress: signerAddress,
          slippage,
          executeApprove: true,
        }, { baseUrl: env.AVNU_BASE_URL });

        const sellSymbol = STATIC_TOKENS.find(
          (t) => t.address.toLowerCase() === sellTokenAddress.toLowerCase()
        )?.symbol ?? sellTokenAddress;
        const buySymbol = STATIC_TOKENS.find(
          (t) => t.address.toLowerCase() === buyTokenAddress.toLowerCase()
        )?.symbol ?? buyTokenAddress;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  calls: swapCalls,
                  callCount: swapCalls.length,
                  sellToken: sellSymbol,
                  buyToken: buySymbol,
                  sellAmount: rawSellAmount,
                  buyAmount: bestQuote.buyAmount?.toString(),
                  slippageBps,
                  signerAddress,
                  note: "Unsigned swap calls (approval + swap). Pass to account.execute(calls) with session key or owner signature.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "x402_starknet_sign_payment_required": {
        const { paymentRequiredHeader } = args as {
          paymentRequiredHeader: string;
        };

        if (signerMode === "proxy") {
          throw new Error(
            "x402_starknet_sign_payment_required is disabled in STARKNET_SIGNER_MODE=proxy (requires direct private key signing)"
          );
        }

        if (!env.STARKNET_RPC_URL || !env.STARKNET_ACCOUNT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
          throw new Error(
            "Missing required env vars for x402 signing (STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY)",
          );
        }

        const { headerValue, payload } = await createStarknetPaymentSignatureHeader({
          paymentRequiredHeader,
          rpcUrl: env.STARKNET_RPC_URL,
          accountAddress: env.STARKNET_ACCOUNT_ADDRESS,
          privateKey: env.STARKNET_PRIVATE_KEY,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  paymentSignatureHeader: headerValue,
                  payload,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_deploy_agent_account": {
        if (!env.AGENT_ACCOUNT_FACTORY_ADDRESS) {
          throw new Error("AGENT_ACCOUNT_FACTORY_ADDRESS not configured");
        }

        const { public_key, token_uri, salt, gasfree = false } = args as {
          public_key: string;
          token_uri: string;
          salt?: string;
          gasfree?: boolean;
        };

        if (!public_key || typeof public_key !== "string") {
          throw new Error("public_key is required");
        }
        if (!token_uri || typeof token_uri !== "string") {
          throw new Error("token_uri is required");
        }

        const parsedPublicKey = parseFelt("public_key", public_key);
        if (parsedPublicKey === 0n) {
          throw new Error("public_key must be non-zero felt");
        }
        const parsedSalt = parseFelt("salt", salt || randomSaltFelt());

        const deployCall: Call = {
          contractAddress: env.AGENT_ACCOUNT_FACTORY_ADDRESS,
          entrypoint: "deploy_account",
          calldata: CallData.compile({
            public_key: `0x${parsedPublicKey.toString(16)}`,
            salt: `0x${parsedSalt.toString(16)}`,
            token_uri: byteArray.byteArrayFromString(token_uri),
          }),
        };

        const execution = await executeTransaction(deployCall, gasfree, TOKENS.STRK, {
          toolName: "starknet_deploy_agent_account",
        });
        const receipt = await provider.waitForTransaction(execution.transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });
        const { accountAddress, agentId } = parseDeployResultFromReceipt(
          receipt,
          env.AGENT_ACCOUNT_FACTORY_ADDRESS
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                transactionHash: execution.transactionHash,
                factoryAddress: env.AGENT_ACCOUNT_FACTORY_ADDRESS,
                publicKey: `0x${parsedPublicKey.toString(16)}`,
                salt: `0x${parsedSalt.toString(16)}`,
                accountAddress,
                agentId,
                executionSurface: execution.configuredSurface,
                executedSurface: execution.executedSurface,
                ...(execution.fallbackFrom
                  ? {
                      fallbackFrom: execution.fallbackFrom,
                      fallbackReason: execution.fallbackReason,
                    }
                  : {}),
              }, null, 2),
            },
          ],
        };
      }

      case "starknet_register_agent": {
        if (!env.ERC8004_IDENTITY_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS not configured");
        }

        const { token_uri, gasfree } = parseToolArgs(
          registerAgentArgsSchema,
          args,
          "starknet_register_agent"
        );

        const identity = parseAddress(
          "ERC8004_IDENTITY_REGISTRY_ADDRESS",
          env.ERC8004_IDENTITY_REGISTRY_ADDRESS
        );

        const entrypoint =
          token_uri && token_uri.length > 0 ? "register_with_token_uri" : "register";
        const calldata =
          token_uri && token_uri.length > 0
            ? CallData.compile({ token_uri: byteArray.byteArrayFromString(token_uri) })
            : [];

        const call: Call = {
          contractAddress: identity,
          entrypoint,
          calldata,
        };

        const execution = await executeTransaction(call, gasfree, TOKENS.STRK, {
          toolName: "starknet_register_agent",
        });
        const receipt = await provider.waitForTransaction(execution.transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });
        const { agentId } = parseIdentityRegisteredFromReceipt(receipt, identity);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  transactionHash: execution.transactionHash,
                  identityRegistry: identity,
                  agentId,
                  executionSurface: execution.configuredSurface,
                  executedSurface: execution.executedSurface,
                  ...(execution.fallbackFrom
                    ? {
                        fallbackFrom: execution.fallbackFrom,
                        fallbackReason: execution.fallbackReason,
                      }
                    : {}),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_get_agent_info": {
        if (!env.ERC8004_IDENTITY_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS not configured");
        }

        const { agent_id, metadata_keys } = parseToolArgs(
          getAgentInfoArgsSchema,
          args,
          "starknet_get_agent_info"
        );

        const requestedKeys = metadata_keys ?? [...DEFAULT_AGENT_INFO_METADATA_KEYS];
        const metadataKeys = [...new Set(requestedKeys.map((key) => key.trim()).filter((key) => key.length > 0))];
        const identity = parseAddress(
          "ERC8004_IDENTITY_REGISTRY_ADDRESS",
          env.ERC8004_IDENTITY_REGISTRY_ADDRESS
        );
        const agentId = parseU256("agent_id", agent_id);

        const existsResult = await provider.callContract({
          contractAddress: identity,
          entrypoint: "agent_exists",
          calldata: CallData.compile({ agent_id: cairo.uint256(agentId) }),
        });
        const exists = readBoolFromCallResult(existsResult);

        if (!exists) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    agentId: agent_id,
                    exists: false,
                    identityRegistry: identity,
                    metadata: {},
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const agentCalldata = CallData.compile({ token_id: cairo.uint256(agentId) });
        const [ownerResult, walletResult, tokenUriResult] = await Promise.all([
          provider.callContract({
            contractAddress: identity,
            entrypoint: "owner_of",
            calldata: agentCalldata,
          }).catch(() => null),
          provider.callContract({
            contractAddress: identity,
            entrypoint: "get_agent_wallet",
            calldata: CallData.compile({ agent_id: cairo.uint256(agentId) }),
          }).catch(() => null),
          provider.callContract({
            contractAddress: identity,
            entrypoint: "token_uri",
            calldata: agentCalldata,
          }).catch(() => null),
        ]);

        const metadataEntries = await Promise.all(
          metadataKeys.map(async (key) => {
            const value = await readIdentityMetadataValue({
              identityRegistryAddress: identity,
              agentId: agent_id,
              key,
            }).catch(() => "");
            return [key, value] as const;
          })
        );
        const metadata = Object.fromEntries(metadataEntries);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  agentId: agent_id,
                  exists: true,
                  identityRegistry: identity,
                  owner: ownerResult ? readAddressFromCallResult(ownerResult) : null,
                  wallet: walletResult ? readAddressFromCallResult(walletResult) : null,
                  tokenUri: tokenUriResult ? decodeByteArrayResult(tokenUriResult) : "",
                  metadata,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_set_agent_metadata":
      case "starknet_update_agent_metadata": {
        if (!env.ERC8004_IDENTITY_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS not configured");
        }

        const { agent_id, key, value, gasfree } = parseToolArgs(
          setAgentMetadataArgsSchema,
          args,
          name
        );

        const identity = parseAddress(
          "ERC8004_IDENTITY_REGISTRY_ADDRESS",
          env.ERC8004_IDENTITY_REGISTRY_ADDRESS
        );

        // agent_id is u256: compile as cairo.uint256
        const agentIdBigInt = parseU256("agent_id", agent_id);
        const calldata = CallData.compile({
          agent_id: cairo.uint256(agentIdBigInt),
          key: byteArray.byteArrayFromString(key),
          value: byteArray.byteArrayFromString(value),
        });

        const call: Call = {
          contractAddress: identity,
          entrypoint: "set_metadata",
          calldata,
        };

        const execution = await executeTransaction(call, gasfree, TOKENS.STRK, {
          toolName: "starknet_set_agent_metadata",
        });
        await provider.waitForTransaction(execution.transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  tool: name,
                  transactionHash,
                  identityRegistry: identity,
                  agentId: agent_id,
                  key,
                  value,
                  executionSurface: execution.configuredSurface,
                  executedSurface: execution.executedSurface,
                  ...(execution.fallbackFrom
                    ? {
                        fallbackFrom: execution.fallbackFrom,
                        fallbackReason: execution.fallbackReason,
                      }
                    : {}),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_get_agent_metadata": {
        if (!env.ERC8004_IDENTITY_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS not configured");
        }

        const { agent_id, key } = args as {
          agent_id: string;
          key: string;
        };

        if (!agent_id) throw new Error("agent_id is required");
        if (!key || key.length === 0) throw new Error("key is required and must be non-empty");

        const identity = parseAddress(
          "ERC8004_IDENTITY_REGISTRY_ADDRESS",
          env.ERC8004_IDENTITY_REGISTRY_ADDRESS
        );

        const value = await readIdentityMetadataValue({
          identityRegistryAddress: identity,
          agentId: agent_id,
          key,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  agentId: agent_id,
                  key,
                  value,
                  identityRegistry: identity,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_get_agent_passport": {
        if (!env.ERC8004_IDENTITY_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS not configured");
        }

        const { agent_id } = args as {
          agent_id: string;
        };

        if (!agent_id) throw new Error("agent_id is required");

        const identity = parseAddress(
          "ERC8004_IDENTITY_REGISTRY_ADDRESS",
          env.ERC8004_IDENTITY_REGISTRY_ADDRESS
        );

        const capsRaw = await readIdentityMetadataValue({
          identityRegistryAddress: identity,
          agentId: agent_id,
          key: "caps",
        });
        const schema = await readIdentityMetadataValue({
          identityRegistryAddress: identity,
          agentId: agent_id,
          key: "passport:schema",
        }).catch(() => "");

        let caps: string[] = [];
        if (capsRaw && capsRaw.trim().length > 0) {
          try {
            const parsed = JSON.parse(capsRaw) as unknown;
            if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
              throw new Error("caps must be a JSON array of strings");
            }
            caps = parsed;
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`Agent passport 'caps' metadata is invalid: ${reason}`);
          }
        }

        const capabilities: Array<Record<string, unknown>> = [];
        const issues: string[] = [];
        for (const capName of caps) {
          const capKey = `capability:${capName}`;
          const rawPayload = await readIdentityMetadataValue({
            identityRegistryAddress: identity,
            agentId: agent_id,
            key: capKey,
          }).catch(() => "");

          if (!rawPayload || rawPayload.trim().length === 0) {
            issues.push(`Missing payload for ${capKey}`);
            continue;
          }

          try {
            const parsed = JSON.parse(rawPayload) as unknown;
            if (!parsed || typeof parsed !== "object") {
              issues.push(`Invalid object payload for ${capKey}`);
              continue;
            }
            capabilities.push(parsed as Record<string, unknown>);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            issues.push(`Invalid JSON payload for ${capKey}: ${reason}`);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  agentId: agent_id,
                  identityRegistry: identity,
                  schema: schema || undefined,
                  caps,
                  capabilities,
                  issues,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_give_feedback": {
        if (!env.ERC8004_REPUTATION_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_REPUTATION_REGISTRY_ADDRESS not configured");
        }

        const {
          agent_id,
          value,
          value_decimals,
          tag1,
          tag2,
          endpoint,
          feedback_uri,
          feedback_hash,
          gasfree,
        } = parseToolArgs(giveFeedbackArgsSchema, args, "starknet_give_feedback");

        const reputation = parseAddress(
          "ERC8004_REPUTATION_REGISTRY_ADDRESS",
          env.ERC8004_REPUTATION_REGISTRY_ADDRESS
        );
        const agentId = parseU256("agent_id", agent_id);
        const feedbackValue = parseI128("value", value);
        const feedbackDecimals = parseU8("value_decimals", value_decimals);
        const feedbackHash = parseU256("feedback_hash", feedback_hash);

        const call: Call = {
          contractAddress: reputation,
          entrypoint: "give_feedback",
          calldata: CallData.compile({
            agent_id: cairo.uint256(agentId),
            value: feedbackValue,
            value_decimals: feedbackDecimals,
            tag1: byteArray.byteArrayFromString(tag1),
            tag2: byteArray.byteArrayFromString(tag2),
            endpoint: byteArray.byteArrayFromString(endpoint),
            feedback_uri: byteArray.byteArrayFromString(feedback_uri),
            feedback_hash: cairo.uint256(feedbackHash),
          }),
        };

        const transactionHash = await executeTransaction(call, gasfree);
        await provider.waitForTransaction(transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  transactionHash,
                  reputationRegistry: reputation,
                  agentId: agent_id,
                  value: feedbackValue.toString(),
                  valueDecimals: feedbackDecimals,
                  tag1,
                  tag2,
                  endpoint,
                  feedbackUri: feedback_uri,
                  feedbackHash: feedbackHash.toString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_get_reputation": {
        if (!env.ERC8004_REPUTATION_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_REPUTATION_REGISTRY_ADDRESS not configured");
        }

        const { agent_id, tag1, tag2 } = parseToolArgs(
          getReputationArgsSchema,
          args,
          "starknet_get_reputation"
        );

        const reputation = parseAddress(
          "ERC8004_REPUTATION_REGISTRY_ADDRESS",
          env.ERC8004_REPUTATION_REGISTRY_ADDRESS
        );
        const agentId = parseU256("agent_id", agent_id);
        const summaryResult = await provider.callContract({
          contractAddress: reputation,
          entrypoint: "get_summary",
          calldata: CallData.compile({
            agent_id: cairo.uint256(agentId),
            client_addresses: [],
            tag1: byteArray.byteArrayFromString(tag1),
            tag2: byteArray.byteArrayFromString(tag2),
          }),
        });

        const summaryArray = toCallResultArray(summaryResult);
        const count = BigInt(summaryArray[0] ?? "0").toString();
        const summaryValueRaw = BigInt(summaryArray[1] ?? "0").toString();
        const valueDecimals = Number(BigInt(summaryArray[2] ?? "0"));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  agentId: agent_id,
                  reputationRegistry: reputation,
                  tag1,
                  tag2,
                  count,
                  summaryValueRaw,
                  valueDecimals,
                  summaryValue: formatSignedDecimal(summaryValueRaw, valueDecimals),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "starknet_request_validation": {
        if (!env.ERC8004_VALIDATION_REGISTRY_ADDRESS) {
          throw new Error("ERC8004_VALIDATION_REGISTRY_ADDRESS not configured");
        }

        const {
          validator_address,
          agent_id,
          request_uri,
          request_hash,
          gasfree,
        } = parseToolArgs(
          requestValidationArgsSchema,
          args,
          "starknet_request_validation"
        );

        const validation = parseAddress(
          "ERC8004_VALIDATION_REGISTRY_ADDRESS",
          env.ERC8004_VALIDATION_REGISTRY_ADDRESS
        );
        const validator = parseAddress("validator_address", validator_address);
        const agentId = parseU256("agent_id", agent_id);
        const requestHash = parseU256("request_hash", request_hash);

        const call: Call = {
          contractAddress: validation,
          entrypoint: "validation_request",
          calldata: CallData.compile({
            validator_address: validator,
            agent_id: cairo.uint256(agentId),
            request_uri: byteArray.byteArrayFromString(request_uri),
            request_hash: cairo.uint256(requestHash),
          }),
        };

        const transactionHash = await executeTransaction(call, gasfree);
        await provider.waitForTransaction(transactionHash, {
          retries: TX_WAIT_RETRIES,
          retryInterval: TX_WAIT_INTERVAL_MS,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  transactionHash,
                  validationRegistry: validation,
                  validatorAddress: validator,
                  agentId: agent_id,
                  requestUri: request_uri,
                  requestHash: requestHash.toString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── Prediction Market Handlers ─────────────────────────────────────────
      case "prediction_get_markets": {
        const { factoryAddress } = args as { factoryAddress: string };

        const factoryCount = await provider.callContract({
          contractAddress: factoryAddress,
          entrypoint: "get_market_count",
          calldata: [],
        });

        const count = Number(
          Array.isArray(factoryCount) ? factoryCount[0] : (factoryCount as any).result?.[0] ?? "0"
        );

        const markets: {
          id: number;
          address: string;
          status: number;
          totalPool: string;
        }[] = [];

        for (let i = 0; i < Math.min(count, 50); i++) {
          const addrResult = await provider.callContract({
            contractAddress: factoryAddress,
            entrypoint: "get_market",
            calldata: [num.toHex(i), "0x0"],
          });
          const addr = Array.isArray(addrResult) ? addrResult[0] : (addrResult as any).result?.[0] ?? "0x0";
          const marketAddr = num.toHex(BigInt(addr));

          const [statusResult, poolResult] = await Promise.all([
            provider.callContract({ contractAddress: marketAddr, entrypoint: "get_status", calldata: [] }),
            provider.callContract({ contractAddress: marketAddr, entrypoint: "get_total_pool", calldata: [] }),
          ]);

          const status = Number(
            Array.isArray(statusResult) ? statusResult[0] : (statusResult as any).result?.[0] ?? "0"
          );
          const poolRaw = Array.isArray(poolResult) ? poolResult[0] : (poolResult as any).result?.[0] ?? "0";

          markets.push({
            id: i,
            address: marketAddr,
            status,
            totalPool: formatAmount(BigInt(poolRaw), 18),
          });
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ marketCount: count, markets }, null, 2) }],
        };
      }

      case "prediction_bet": {
        const {
          marketAddress,
          outcome,
          amount,
          collateralToken = TOKENS.STRK,
          gasfree = false,
          gasToken,
        } = args as {
          marketAddress: string;
          outcome: number;
          amount: string;
          collateralToken?: string;
          gasfree?: boolean;
          gasToken?: string;
        };

        const tokenAddress = await resolveTokenAddressAsync(collateralToken);
        const amountWei = await parseAmount(amount, tokenAddress);
        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;

        const approveCall: Call = {
          contractAddress: tokenAddress,
          entrypoint: "approve",
          calldata: CallData.compile({ spender: marketAddress, amount: cairo.uint256(amountWei) }),
        };
        const betCall: Call = {
          contractAddress: marketAddress,
          entrypoint: "bet",
          calldata: CallData.compile({ outcome, amount: cairo.uint256(amountWei) }),
        };

        const transactionHash = await executeTransaction([approveCall, betCall], gasfree, gasTokenAddress);
        await provider.waitForTransaction(transactionHash);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, transactionHash, marketAddress, outcome: outcome === 1 ? "YES" : "NO", amount, gasfree }, null, 2),
          }],
        };
      }

      case "prediction_record_prediction": {
        const { trackerAddress, marketId, probability, gasfree = false, gasToken } = args as {
          trackerAddress: string;
          marketId: number;
          probability: number;
          gasfree?: boolean;
          gasToken?: string;
        };

        if (probability < 0 || probability > 1) throw new Error("Probability must be between 0.0 and 1.0");

        const scaledProb = BigInt(Math.round(probability * 1e18));
        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;

        const recordCall: Call = {
          contractAddress: trackerAddress,
          entrypoint: "record_prediction",
          calldata: CallData.compile({ market_id: cairo.uint256(marketId), predicted_prob: cairo.uint256(scaledProb) }),
        };

        const transactionHash = await executeTransaction(recordCall, gasfree, gasTokenAddress);
        await provider.waitForTransaction(transactionHash);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, transactionHash, trackerAddress, marketId, probability, scaledProbability: scaledProb.toString() }, null, 2),
          }],
        };
      }

      case "prediction_get_leaderboard": {
        const { trackerAddress, marketId } = args as { trackerAddress: string; marketId: number };

        const countResult = await provider.callContract({
          contractAddress: trackerAddress,
          entrypoint: "get_market_predictor_count",
          calldata: CallData.compile({ market_id: cairo.uint256(marketId) }),
        });
        const count = Number(Array.isArray(countResult) ? countResult[0] : (countResult as any).result?.[0] ?? "0");

        const agents: { agent: string; prediction: string; brierScore: string; predictionCount: number }[] = [];
        for (let i = 0; i < Math.min(count, 100); i++) {
          const agentResult = await provider.callContract({
            contractAddress: trackerAddress,
            entrypoint: "get_market_predictor",
            calldata: CallData.compile({ market_id: cairo.uint256(marketId), index: i }),
          });
          const agentAddr = num.toHex(BigInt(
            Array.isArray(agentResult) ? agentResult[0] : (agentResult as any).result?.[0] ?? "0x0"
          ));

          const [predResult, brierResult] = await Promise.all([
            provider.callContract({
              contractAddress: trackerAddress,
              entrypoint: "get_prediction",
              calldata: CallData.compile({ agent: agentAddr, market_id: cairo.uint256(marketId) }),
            }),
            provider.callContract({ contractAddress: trackerAddress, entrypoint: "get_brier_score", calldata: [agentAddr] }),
          ]);

          const predRaw = Array.isArray(predResult) ? predResult[0] : (predResult as any).result?.[0] ?? "0";
          const brierRaw = Array.isArray(brierResult) ? brierResult : (brierResult as any).result ?? [];
          const cumulativeBrier = BigInt(brierRaw[0] ?? "0");
          const predCount = Number(brierRaw[2] ?? brierRaw[1] ?? "0");
          const avgBrier = predCount > 0 ? Number(cumulativeBrier) / (predCount * 1e18) : 0;

          agents.push({ agent: agentAddr, prediction: (Number(BigInt(predRaw)) / 1e18).toFixed(4), brierScore: avgBrier.toFixed(4), predictionCount: predCount });
        }

        agents.sort((a, b) => parseFloat(a.brierScore) - parseFloat(b.brierScore));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ trackerAddress, marketId, agentCount: count, leaderboard: agents.map((a, i) => ({ rank: i + 1, ...a })) }, null, 2),
          }],
        };
      }

      case "prediction_claim": {
        const { marketAddress, gasfree = false, gasToken } = args as {
          marketAddress: string;
          gasfree?: boolean;
          gasToken?: string;
        };

        const gasTokenAddress = gasToken ? await resolveTokenAddressAsync(gasToken) : TOKENS.STRK;
        const claimCall: Call = { contractAddress: marketAddress, entrypoint: "claim", calldata: [] };
        const transactionHash = await executeTransaction(claimCall, gasfree, gasTokenAddress);
        await provider.waitForTransaction(transactionHash);

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash, marketAddress }, null, 2) }],
        };
      }

      // ── Research Tool Handlers ──────────────────────────────────────────────
      case "research_web_search": {
        const { query, recency } = args as { query: string; recency?: "day" | "week" | "month" };

        // Map recency to Tavily `days` (number of days to look back).
        const tavilyDays = recency === "day" ? 1 : recency === "month" ? 30 : 7;
        // Map recency to Brave freshness code.
        const braveFreshness = recency === "day" ? "pd" : recency === "month" ? "pm" : "pw";

        // Try Tavily first
        const tavilyKey = process.env.TAVILY_API_KEY;
        if (tavilyKey) {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: tavilyKey,
              query,
              search_depth: "basic",
              include_answer: true,
              include_images: false,
              max_results: 5,
              days: tavilyDays,
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const data = await res.json() as any;
            const answer = data.answer ?? "";
            const results = (data.results ?? []).slice(0, 5).map((r: any) => ({
              title: r.title,
              snippet: r.content?.slice(0, 120),
              url: r.url,
            }));
            return { content: [{ type: "text", text: JSON.stringify({ source: "tavily", answer, results }, null, 2) }] };
          }
        }

        // Brave fallback
        const braveKey = process.env.BRAVE_SEARCH_API_KEY;
        if (!braveKey) {
          return { content: [{ type: "text", text: JSON.stringify({ source: "none", answer: "No search API key configured (TAVILY_API_KEY or BRAVE_SEARCH_API_KEY)", results: [] }, null, 2) }] };
        }
        const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&freshness=${braveFreshness}`;
        const braveRes = await fetch(braveUrl, {
          headers: { Accept: "application/json", "X-Subscription-Token": braveKey },
          signal: AbortSignal.timeout(5000),
        });
        if (!braveRes.ok) throw new Error(`Brave API ${braveRes.status}`);
        const braveData = await braveRes.json() as any;
        const items = (braveData.web?.results ?? []).slice(0, 5).map((r: any) => ({
          title: r.title,
          snippet: r.description?.slice(0, 120),
          url: r.url,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ source: "brave", answer: "", results: items }, null, 2) }] };
      }

      case "research_polymarket": {
        const { query } = args as { query: string };
        const url = `https://gamma-api.polymarket.com/markets?limit=10&active=true&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Polymarket API ${res.status}`);
        const data = await res.json() as any;
        const markets = (Array.isArray(data) ? data : data.markets ?? []).slice(0, 5).map((m: any) => ({
          question: m.question ?? m.title,
          impliedProbYes: m.outcomePrices
            ? parseFloat(m.outcomePrices[0] ?? "0.5")
            : (m.probability ?? null),
          totalVolume: m.volumeNum ?? m.volume ?? 0,
          url: m.url ?? `https://polymarket.com/event/${m.slug ?? ""}`,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ query, markets }, null, 2) }] };
      }

      case "research_crypto_prices": {
        const { tokens } = args as { tokens: string };
        const ids = tokens.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).join(",");
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
        const headers: Record<string, string> = { Accept: "application/json" };
        if (process.env.COINGECKO_API_KEY) headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`CoinGecko API ${res.status}`);
        const data = await res.json() as any;
        const prices = Object.entries(data as Record<string, any>).map(([id, info]: [string, any]) => ({
          token: id,
          priceUsd: info.usd,
          change24h: info.usd_24h_change?.toFixed(2),
        }));
        return { content: [{ type: "text", text: JSON.stringify({ tokens, prices }, null, 2) }] };
      }

      case "research_sports_scores": {
        const { query } = args as { query: string };
        const sport = /nba/i.test(query) ? "basketball/nba" : /mlb/i.test(query) ? "baseball/mlb" : "football/nfl";
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/scoreboard`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`ESPN API ${res.status}`);
        const data = await res.json() as any;
        const events = (data.events ?? []).slice(0, 5).map((e: any) => ({
          name: e.name,
          shortName: e.shortName,
          status: e.status?.type?.description,
          score: e.competitions?.[0]?.competitors?.map((c: any) => `${c.team?.abbreviation} ${c.score}`).join(" vs "),
        }));
        return { content: [{ type: "text", text: JSON.stringify({ sport, query, events }, null, 2) }] };
      }

      case "huginn_log_thought": {
        const { reasoning, agentName } = args as { reasoning: string; agentName?: string };
        const huginnAddress = process.env.HUGINN_REGISTRY_ADDRESS;
        if (!huginnAddress || huginnAddress === "0x0") {
          return { content: [{ type: "text", text: JSON.stringify({ status: "skipped", reason: "HUGINN_REGISTRY_ADDRESS not configured" }, null, 2) }] };
        }

        const hashBuffer = await import("node:crypto").then(c =>
          c.createHash("sha256").update(reasoning).digest()
        );
        const bytes = hashBuffer;
        const highHex = bytes.slice(0, 16).toString("hex");
        const lowHex = bytes.slice(16, 32).toString("hex");
        const thoughtHash = "0x" + highHex + lowHex;
        const highBigInt = BigInt("0x" + highHex);
        const lowBigInt = BigInt("0x" + lowHex);

        // Capture as const so TypeScript's closure narrowing is satisfied — huginnAddress
        // is already guaranteed non-null/non-zero by the early-return guard above.
        const huginnAddr: string = huginnAddress;

        const logCall: Call = {
          contractAddress: huginnAddr,
          entrypoint: "log_thought",
          calldata: CallData.compile({ thought_hash: { low: lowBigInt, high: highBigInt } }),
        };

        // Auto-registration recovery: log_thought() panics with 'Agent not registered'
        // if the agent has never called register_agent(). Attempt once; if it fails with
        // that error, register first then retry. register_agent() is idempotent-by-catch
        // ('Agent already registered' is treated as a no-op).
        async function tryLog(allowRetry: boolean): Promise<string> {
          try {
            const tx = await executeTransaction(logCall, false, TOKENS.STRK);
            await provider.waitForTransaction(tx);
            return tx;
          } catch (err: any) {
            if (allowRetry && String(err).includes("Agent not registered")) {
              // Register using agentName (max 31 ASCII chars for felt252).
              const name = shortString.encodeShortString((agentName ?? "MCPAgent").slice(0, 31));
              const registerCall: Call = {
                contractAddress: huginnAddr,
                entrypoint: "register_agent",
                calldata: [
                  name,    // name: felt252
                  "0x0",   // ByteArray::data.len        = 0
                  "0x0",   // ByteArray::pending_word    = 0
                  "0x0",   // ByteArray::pending_word_len = 0
                ],
              };
              try {
                const regTx = await executeTransaction(registerCall, false, TOKENS.STRK);
                await provider.waitForTransaction(regTx);
              } catch (regErr: any) {
                // 'Agent already registered' is fine — another process beat us to it.
                if (!String(regErr).includes("Agent already registered")) throw regErr;
              }
              return tryLog(false);
            }
            throw err;
          }
        }

        const transactionHash = await tryLog(true);
        return { content: [{ type: "text", text: JSON.stringify({ status: "success", thoughtHash, transactionHash, huginnAddress }, null, 2) }] };
      }

      case "huginn_get_thought": {
        const { thoughtHash, huginnAddress: huginnAddr } = args as { thoughtHash: string; huginnAddress?: string };
        const huginnAddress = huginnAddr ?? process.env.HUGINN_REGISTRY_ADDRESS;
        if (!huginnAddress || huginnAddress === "0x0") {
          return { content: [{ type: "text", text: JSON.stringify({ status: "skipped", reason: "Huginn address not provided" }, null, 2) }] };
        }

        // Parse thoughtHash into u256
        const hashHex = thoughtHash.replace(/^0x/, "");
        const highHex = hashHex.slice(0, 32).padStart(32, "0");
        const lowHex = hashHex.slice(32).padStart(32, "0");
        const high = BigInt("0x" + highHex);
        const low = BigInt("0x" + lowHex);

        const existsResult = await provider.callContract({
          contractAddress: huginnAddress,
          entrypoint: "proof_exists",
          calldata: CallData.compile({ thought_hash: { low, high } }),
        });
        const proofExists = Array.isArray(existsResult) ? existsResult[0] !== "0x0" : false;

        return { content: [{ type: "text", text: JSON.stringify({ thoughtHash, huginnAddress, proofExists }, null, 2) }] };
      }

      case "prediction_resolve": {
        const { marketAddress, outcome, marketId, trackerAddress: trackerAddr, gasfree = false } = args as {
          marketAddress: string;
          outcome: number;
          marketId?: number;
          trackerAddress?: string;
          gasfree?: boolean;
        };

        const resolveCall: Call = {
          contractAddress: marketAddress,
          entrypoint: "resolve",
          calldata: CallData.compile({ winning_outcome: outcome }),
        };

        const calls: Call[] = [resolveCall];

        const trackerAddress = trackerAddr ?? process.env.ACCURACY_TRACKER_ADDRESS;
        if (marketId !== undefined && trackerAddress && trackerAddress !== "0x0") {
          calls.push({
            contractAddress: trackerAddress,
            entrypoint: "finalize_market",
            calldata: CallData.compile({
              market_id: cairo.uint256(marketId),
              actual_outcome: cairo.uint256(outcome),
            }),
          });
        }

        const transactionHash = await executeTransaction(calls, gasfree, TOKENS.STRK);
        await provider.waitForTransaction(transactionHash);

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash, marketAddress, outcome, marketId }, null, 2) }],
        };
      }

      case "prediction_get_market": {
        const { marketAddress } = args as { marketAddress: string };

        // Market ABI entrypoints: get_status (u8), get_total_pool (u256),
        // get_implied_probs (Array<(u8, u256)>), get_market_info (felt252, u64, addr, addr, u16).
        // There are NO get_yes_pool / get_no_pool / get_resolution_time entrypoints.
        const [statusResult, poolResult, impliedResult, marketInfoResult] = await Promise.all([
          provider.callContract({ contractAddress: marketAddress, entrypoint: "get_status", calldata: [] }),
          provider.callContract({ contractAddress: marketAddress, entrypoint: "get_total_pool", calldata: [] }),
          provider.callContract({ contractAddress: marketAddress, entrypoint: "get_implied_probs", calldata: [] }).catch(() => null),
          provider.callContract({ contractAddress: marketAddress, entrypoint: "get_market_info", calldata: [] }).catch(() => null),
        ]);

        // starknet.js v8 callContract returns string[] directly.
        const extractFirst = (r: any): string => Array.isArray(r) ? r[0] : (r as any)?.result?.[0] ?? "0x0";

        const status = Number(BigInt(extractFirst(statusResult)));
        // u256 = [low, high] felts. Total pool low is at index 0.
        const totalPoolLow = poolResult && Array.isArray(poolResult) ? BigInt(poolResult[0]) : 0n;
        const totalPoolHigh = poolResult && Array.isArray(poolResult) ? BigInt(poolResult[1] ?? "0x0") : 0n;
        const totalPool = formatAmount(totalPoolLow + totalPoolHigh * (2n ** 128n), 18);

        // Parse get_implied_probs: Array<(u8, u256)>
        // Serialized as: [count, outcome0, low0, high0, outcome1, low1, high1, ...]
        let yesPool: string | null = null;
        let noPool: string | null = null;
        let impliedProbYes: number | null = null;
        if (impliedResult && Array.isArray(impliedResult) && impliedResult.length >= 1) {
          const count = Number(BigInt(impliedResult[0]));
          for (let i = 0; i < count; i++) {
            const base = 1 + i * 3;
            const outcome = Number(BigInt(impliedResult[base] ?? "0x0"));
            const poolLow = BigInt(impliedResult[base + 1] ?? "0x0");
            const poolHigh = BigInt(impliedResult[base + 2] ?? "0x0");
            const poolAmount = poolLow + poolHigh * (2n ** 128n);
            if (outcome === 1) yesPool = formatAmount(poolAmount, 18);
            else noPool = formatAmount(poolAmount, 18);
          }
          if (yesPool !== null && noPool !== null) {
            const yes = parseFloat(yesPool);
            const total = yes + parseFloat(noPool);
            if (total > 0) impliedProbYes = yes / total;
          }
        }

        // Parse get_market_info: (felt252, u64, ContractAddress, ContractAddress, u16)
        // = [questionHash, resolutionTime, creator, token, fee] — each 1 felt except
        // felt252/u64/address are all 1 felt in Starknet serialization.
        let resolutionTime: number | null = null;
        if (marketInfoResult && Array.isArray(marketInfoResult) && marketInfoResult.length >= 2) {
          resolutionTime = Number(BigInt(marketInfoResult[1]));
        }

        const statusLabel = status === 0 ? "OPEN" : status === 1 ? "RESOLVED" : "CANCELLED";

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              marketAddress,
              status,
              statusLabel,
              totalPool,
              yesPool,
              noPool,
              impliedProbYes: impliedProbYes !== null ? (impliedProbYes * 100).toFixed(1) + "%" : null,
              resolutionTime,
              resolutionDate: resolutionTime ? new Date(resolutionTime * 1000).toISOString() : null,
            }, null, 2),
          }],
        };
      }

      // ── ProveWork Handlers ──────────────────────────────────────────────────

      case "provework_post_task": {
        const v = proveworkPostTaskSchema.parse(args);
        const tokenAddr = v.collateralToken ?? TOKENS.STRK;
        const amountWei = parseAmountSync(v.rewardAmount);

        const calls: Call[] = [
          {
            contractAddress: tokenAddr,
            entrypoint: "approve",
            calldata: CallData.compile({ spender: v.escrowAddress, amount: cairo.uint256(amountWei) }),
          },
          {
            contractAddress: v.escrowAddress,
            entrypoint: "post_task",
            calldata: CallData.compile({
              description_hash: v.descriptionHash,
              reward_amount: cairo.uint256(amountWei),
              deadline: v.deadline,
              required_validators: v.requiredValidators,
            }),
          },
        ];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, escrowAddress: v.escrowAddress }, null, 2) }] };
      }

      case "provework_bid_task": {
        const v = proveworkBidTaskSchema.parse(args);
        const amountWei = parseAmountSync(v.bidAmount);
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "bid_task",
          calldata: CallData.compile({
            task_id: cairo.uint256(v.taskId),
            bid_amount: cairo.uint256(amountWei),
          }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId }, null, 2) }] };
      }

      case "provework_submit_proof": {
        const v = proveworkSubmitProofSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "submit_proof",
          calldata: CallData.compile({
            task_id: cairo.uint256(v.taskId),
            proof_hash: v.proofHash,
          }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId }, null, 2) }] };
      }

      case "provework_approve_task": {
        const v = proveworkApproveTaskSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "approve_task",
          calldata: CallData.compile({ task_id: cairo.uint256(v.taskId) }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId }, null, 2) }] };
      }

      case "provework_cancel_task": {
        const v = proveworkCancelTaskSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "cancel_task",
          calldata: CallData.compile({ task_id: cairo.uint256(v.taskId) }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId }, null, 2) }] };
      }

      case "provework_dispute_task": {
        const v = proveworkDisputeTaskSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "dispute_task",
          calldata: CallData.compile({
            task_id: cairo.uint256(v.taskId),
            reason_hash: v.reasonHash,
          }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId }, null, 2) }] };
      }

      case "provework_resolve_dispute": {
        const v = proveworkResolveDisputeSchema.parse(args);
        // DisputeRuling enum: 0=AssigneeWins, 1=PosterWins, 2=Split
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "resolve_dispute",
          calldata: CallData.compile({
            task_id: cairo.uint256(v.taskId),
            ruling: v.ruling,
          }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        const rulingNames = ["AssigneeWins", "PosterWins", "Split"];
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId, ruling: rulingNames[v.ruling] }, null, 2) }] };
      }

      case "provework_force_settle": {
        const v = proveworkForceSettleSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.escrowAddress,
          entrypoint: "force_settle_dispute",
          calldata: CallData.compile({ task_id: cairo.uint256(v.taskId) }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, taskId: v.taskId, action: "force_settled" }, null, 2) }] };
      }

      case "provework_get_tasks": {
        const v = proveworkGetTasksSchema.parse(args);

        const countResult = await provider.callContract({
          contractAddress: v.escrowAddress,
          entrypoint: "get_task_count",
          calldata: [],
        });
        const totalCount = Number(BigInt(Array.isArray(countResult) ? countResult[0] : "0x0"));

        const tasks = [];
        const maxTasks = Math.min(v.limit, totalCount);
        for (let i = 1; i <= maxTasks; i++) {
          try {
            const result = await provider.callContract({
              contractAddress: v.escrowAddress,
              entrypoint: "get_task",
              calldata: CallData.compile({ task_id: cairo.uint256(i) }),
            });
            const flat = Array.isArray(result) ? result : [];
            tasks.push({
              taskId: i,
              poster: flat[0] ?? "0x0",
              descriptionHash: flat[1] ?? "0x0",
              rewardAmount: flat.length >= 4 ? formatAmount(BigInt(flat[2]) + BigInt(flat[3]) * (2n ** 128n), 18) : "0",
              deadline: flat.length >= 5 ? Number(BigInt(flat[4])) : 0,
              status: flat.length >= 7 ? (["Open", "Assigned", "Submitted", "Approved", "Disputed", "Cancelled", "Settled"][Number(BigInt(flat[6]))] ?? "Unknown") : "Unknown",
            });
          } catch {
            // skip inaccessible tasks
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ totalCount, tasks }, null, 2) }] };
      }

      // ── StarkMint Handlers ──────────────────────────────────────────────────

      case "starkmint_launch_token": {
        const v = starkmintLaunchTokenSchema.parse(args);

        // Encode name/symbol as felt252 short strings for Cairo
        const nameEncoded = shortString.encodeShortString(v.name);
        const symbolEncoded = shortString.encodeShortString(v.symbol);

        const calls: Call[] = [{
          contractAddress: v.factoryAddress,
          entrypoint: "launch_token",
          calldata: CallData.compile({
            name: nameEncoded,
            symbol: symbolEncoded,
            curve_type: v.curveType,
            fee_bps: v.feeBps,
            agent_id: cairo.uint256(v.agentId),
          }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, factoryAddress: v.factoryAddress, name: v.name, symbol: v.symbol }, null, 2) }] };
      }

      case "starkmint_buy": {
        const v = starkmintBuySchema.parse(args);
        const tokenAddr = v.reserveToken ?? TOKENS.STRK;
        const amountWei = parseAmountSync(v.amount);

        // Get price first to know how much reserve to approve
        const priceResult = await provider.callContract({
          contractAddress: v.curveAddress,
          entrypoint: "get_buy_price",
          calldata: CallData.compile({ amount: cairo.uint256(amountWei) }),
        });
        const priceLow = BigInt(Array.isArray(priceResult) ? priceResult[0] : "0x0");
        const priceHigh = BigInt(Array.isArray(priceResult) ? (priceResult[1] ?? "0x0") : "0x0");
        const totalCost = priceLow + priceHigh * (2n ** 128n);

        // Approve + buy — get_buy_price returns raw cost; buy() adds fee on top (max 10%).
        // 15% buffer covers fee + rounding.
        const approveAmount = totalCost * 115n / 100n;
        const calls: Call[] = [
          {
            contractAddress: tokenAddr,
            entrypoint: "approve",
            calldata: CallData.compile({ spender: v.curveAddress, amount: cairo.uint256(approveAmount) }),
          },
          {
            contractAddress: v.curveAddress,
            entrypoint: "buy",
            calldata: CallData.compile({ amount: cairo.uint256(amountWei) }),
          },
        ];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, amount: v.amount, cost: formatAmount(totalCost, 18) }, null, 2) }] };
      }

      case "starkmint_sell": {
        const v = starkmintSellSchema.parse(args);
        const amountWei = parseAmountSync(v.amount);
        const calls: Call[] = [{
          contractAddress: v.curveAddress,
          entrypoint: "sell",
          calldata: CallData.compile({ amount: cairo.uint256(amountWei) }),
        }];

        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);

        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, amount: v.amount }, null, 2) }] };
      }

      case "starkmint_get_price": {
        const v = starkmintGetPriceSchema.parse(args);
        const amountWei = parseAmountSync(v.amount);

        const [buyResult, sellResult, supplyResult] = await Promise.all([
          provider.callContract({
            contractAddress: v.curveAddress,
            entrypoint: "get_buy_price",
            calldata: CallData.compile({ amount: cairo.uint256(amountWei) }),
          }),
          provider.callContract({
            contractAddress: v.curveAddress,
            entrypoint: "get_sell_price",
            calldata: CallData.compile({ amount: cairo.uint256(amountWei) }),
          }),
          provider.callContract({
            contractAddress: v.curveAddress,
            entrypoint: "get_current_supply",
            calldata: [],
          }),
        ]);

        const extractU256 = (r: any) => {
          const arr = Array.isArray(r) ? r : [];
          return BigInt(arr[0] ?? "0x0") + BigInt(arr[1] ?? "0x0") * (2n ** 128n);
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              curveAddress: v.curveAddress,
              amount: v.amount,
              buyPrice: formatAmount(extractU256(buyResult), 18),
              sellPrice: formatAmount(extractU256(sellResult), 18),
              currentSupply: formatAmount(extractU256(supplyResult), 18),
            }, null, 2),
          }],
        };
      }

      case "starkmint_get_launches": {
        const v = starkmintGetLaunchesSchema.parse(args);

        const countResult = await provider.callContract({
          contractAddress: v.factoryAddress,
          entrypoint: "get_launch_count",
          calldata: [],
        });
        const totalCount = Number(BigInt(Array.isArray(countResult) ? countResult[0] : "0x0"));

        const launches = [];
        const maxLaunches = Math.min(v.limit, totalCount);
        for (let i = 0; i < maxLaunches; i++) {
          try {
            const result = await provider.callContract({
              contractAddress: v.factoryAddress,
              entrypoint: "get_launch",
              calldata: CallData.compile({ index: cairo.uint256(i) }),
            });
            const flat = Array.isArray(result) ? result : [];
            const curveTypeNames = ["Linear", "Quadratic", "Sigmoid"];
            launches.push({
              index: i,
              token: flat[0] ?? "0x0",
              curve: flat[1] ?? "0x0",
              creator: flat[2] ?? "0x0",
              curveType: flat.length > 3 ? (curveTypeNames[Number(BigInt(flat[3]))] ?? "Unknown") : "Unknown",
              agentId: flat.length > 5 ? String(BigInt(flat[4]) + BigInt(flat[5]) * (2n ** 128n)) : "0",
              createdAt: flat.length > 6 ? Number(BigInt(flat[6])) : 0,
            });
          } catch {
            // skip
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ totalCount, launches }, null, 2) }] };
      }

      // ── Guild Handlers ─────────────────────────────────────────────────────

      case "guild_create": {
        const v = guildCreateSchema.parse(args);
        const amountWei = parseAmountSync(v.minStake);
        const calls: Call[] = [{
          contractAddress: v.registryAddress,
          entrypoint: "create_guild",
          calldata: CallData.compile({
            name_hash: v.nameHash,
            min_stake: cairo.uint256(amountWei),
          }),
        }];
        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash }, null, 2) }] };
      }

      case "guild_join": {
        const v = guildJoinSchema.parse(args);
        const tokenAddr = v.stakeToken ?? TOKENS.STRK;
        const amountWei = parseAmountSync(v.stakeAmount);
        const calls: Call[] = [
          {
            contractAddress: tokenAddr,
            entrypoint: "approve",
            calldata: CallData.compile({ spender: v.registryAddress, amount: cairo.uint256(amountWei) }),
          },
          {
            contractAddress: v.registryAddress,
            entrypoint: "join_guild",
            calldata: CallData.compile({
              guild_id: cairo.uint256(v.guildId),
              stake_amount: cairo.uint256(amountWei),
            }),
          },
        ];
        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, guildId: v.guildId }, null, 2) }] };
      }

      case "guild_leave": {
        const v = guildLeaveSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.registryAddress,
          entrypoint: "leave_guild",
          calldata: CallData.compile({ guild_id: cairo.uint256(v.guildId) }),
        }];
        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, guildId: v.guildId }, null, 2) }] };
      }

      case "guild_propose": {
        const v = guildProposeSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.daoAddress,
          entrypoint: "propose",
          calldata: CallData.compile({
            guild_id: cairo.uint256(v.guildId),
            description_hash: v.descriptionHash,
            quorum: cairo.uint256(parseAmountSync(v.quorum)),
            deadline: v.deadline,
          }),
        }];
        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash }, null, 2) }] };
      }

      case "guild_vote": {
        const v = guildVoteSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.daoAddress,
          entrypoint: "vote",
          calldata: CallData.compile({
            proposal_id: cairo.uint256(v.proposalId),
            support: v.support ? 1 : 0,
          }),
        }];
        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, proposalId: v.proposalId, support: v.support }, null, 2) }] };
      }

      case "guild_execute": {
        const v = guildExecuteSchema.parse(args);
        const calls: Call[] = [{
          contractAddress: v.daoAddress,
          entrypoint: "execute",
          calldata: CallData.compile({ proposal_id: cairo.uint256(v.proposalId) }),
        }];
        const txHash = await executeTransaction(calls, false, TOKENS.STRK);
        await provider.waitForTransaction(txHash);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, transactionHash: txHash, proposalId: v.proposalId }, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const userMessage = formatErrorMessage(errorMessage);
    const normalized = normalizeExecutionError(executionSurface, errorMessage);

    // Log the full error to stderr for operators; never expose to the agent.
    log({ level: "error", event: "tool.error", tool: name, details: { error: errorMessage } });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: true,
            code: normalized.code,
            surface: normalized.surface,
            message: userMessage,
            tool: name,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server (stdio mode) — only when this file is the entry point.
// When imported by http-server.ts, this block is skipped.
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log({ level: "info", event: "server.started", details: { transport: "stdio" } });
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] === __filename ||
  process.argv[1]?.endsWith("/dist/index.js") ||
  process.argv[1]?.endsWith("/index.js");

if (isDirectRun) {
  main().catch((error) => {
    log({
      level: "error",
      event: "server.fatal",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    process.exit(1);
  });
}
