#!/usr/bin/env tsx

import process from "node:process";
import os from "node:os";
import {
  Account,
  RpcProvider,
  stark,
  type TypedData,
} from "starknet";

type JsonMap = Record<string, unknown>;
type ChallengeAction =
  | "register_agent"
  | "update_agent"
  | "post_contribution"
  | "heartbeat_agent";

interface SharedOptions {
  baseUrl: string;
  rpcUrl: string;
  walletAddress?: string;
  privateKey?: string;
  timeoutMs: number;
  challengeTtlSecs: number;
  json: boolean;
}

interface RequestResult {
  ok: boolean;
  status: number;
  json?: any;
  text?: string;
}

function usage(): void {
  console.log(`HiveCaster CLI (scaffold)

Usage:
  pnpm hivecaster <command> [options]
  tsx scripts/hivecaster.ts <command> [options]

Commands:
  init
    Check core protocol surfaces and print bootstrap summary.

  register --name "<agent name>" [--handle my-agent] [--topics politics,tech]
    Register or update an independent worker profile.

  heartbeat --agent-id <id> [--active true]
    Send a signed heartbeat for your registered agent.

  forecast --agent-id <id> --market-id <n> --probability <0..1> [--content "..."]
    Post a signed forecast contribution.

Global options:
  --base-url <url>              API base URL (env: HIVECASTER_BASE_URL)
  --rpc-url <url>               Starknet RPC URL (env: HIVECASTER_RPC_URL)
  --wallet <0x...>              Wallet address (env: HIVECASTER_WALLET_ADDRESS)
  --private-key <0x...>         Wallet private key (env: HIVECASTER_PRIVATE_KEY)
  --timeout-ms <ms>             Request timeout (default 12000)
  --challenge-ttl-secs <sec>    Challenge TTL (default 180)
  --json                        JSON output mode
  -h, --help

Env shortcuts:
  HIVECASTER_BASE_URL=http://localhost:3001
  HIVECASTER_RPC_URL=https://starknet-sepolia.public.blastapi.io
  HIVECASTER_WALLET_ADDRESS=0x...
  HIVECASTER_PRIVATE_KEY=0x...
  HIVECASTER_AGENT_ID=0x...:my-agent
  HIVECASTER_AGENT_NAME=My Agent
  HIVECASTER_AGENT_HANDLE=my-agent
  HIVECASTER_AGENT_TOPICS=politics,tech,sports,world
`);
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  return parsed.toString().replace(/\/+$/, "");
}

function parseIntOrDefault(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function parseFloatOrDefault(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return !["0", "false", "off", "no"].includes(normalized);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function short(value: string, max = 420): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = value;
  }
  return out as T;
}

function normalizeSignature(signature: unknown): string[] {
  return stark.formatSignature(signature as any).map((item) => String(item));
}

function requireValue(value: string | undefined, label: string): string {
  const next = String(value ?? "").trim();
  if (!next) throw new Error(`${label} is required`);
  return next;
}

function ensureWalletConfig(options: SharedOptions): { walletAddress: string; privateKey: string } {
  const walletAddress = requireValue(options.walletAddress, "wallet address (--wallet or HIVECASTER_WALLET_ADDRESS)");
  const privateKey = requireValue(options.privateKey, "private key (--private-key or HIVECASTER_PRIVATE_KEY)");
  return { walletAddress: walletAddress.toLowerCase(), privateKey };
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<RequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // noop
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      text: err?.message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function issueChallengeAndSign(args: {
  options: SharedOptions;
  walletAddress: string;
  account: Account;
  action: ChallengeAction;
  payload: JsonMap;
}): Promise<{ challengeId: string; signature: string[] }> {
  const challenge = await requestJson(
    endpoint(args.options.baseUrl, "/api/network/auth/challenge"),
    {
      method: "POST",
      body: JSON.stringify({
        action: args.action,
        walletAddress: args.walletAddress,
        payload: args.payload,
        ttlSecs: args.options.challengeTtlSecs,
      }),
    },
    args.options.timeoutMs
  );

  if (!challenge.ok) {
    throw new Error(
      `challenge failed (${args.action}, HTTP ${challenge.status}): ${short(
        challenge.text || JSON.stringify(challenge.json ?? {})
      )}`
    );
  }

  const issued = challenge.json?.challenge;
  if (!issued?.id || !issued?.typedData) {
    throw new Error("challenge response missing challenge.id or challenge.typedData");
  }

  const signature = normalizeSignature(
    await args.account.signMessage(issued.typedData as TypedData)
  );
  if (!Array.isArray(signature) || signature.length === 0) {
    throw new Error("failed to produce Starknet signature");
  }

  return {
    challengeId: String(issued.id),
    signature,
  };
}

async function signedPost(args: {
  options: SharedOptions;
  action: ChallengeAction;
  path: string;
  payload: JsonMap;
  walletAddress: string;
  account: Account;
}): Promise<RequestResult> {
  const auth = await issueChallengeAndSign({
    options: args.options,
    walletAddress: args.walletAddress,
    account: args.account,
    action: args.action,
    payload: args.payload,
  });

  return requestJson(
    endpoint(args.options.baseUrl, args.path),
    {
      method: "POST",
      body: JSON.stringify({
        ...args.payload,
        auth: {
          challengeId: auth.challengeId,
          walletAddress: args.walletAddress,
          signature: auth.signature,
        },
      }),
    },
    args.options.timeoutMs
  );
}

function buildAccount(options: SharedOptions): { account: Account; walletAddress: string } {
  const { walletAddress, privateKey } = ensureWalletConfig(options);
  const provider = new RpcProvider({ nodeUrl: options.rpcUrl });
  const account = new Account({
    provider,
    address: walletAddress,
    signer: privateKey,
  });
  return {
    account,
    walletAddress,
  };
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseSharedOptions(allArgs: string[]): SharedOptions {
  const baseUrl = normalizeBaseUrl(
    getFlagValue(allArgs, "--base-url") ||
      process.env.HIVECASTER_BASE_URL ||
      "http://localhost:3001"
  );
  const rpcUrl =
    getFlagValue(allArgs, "--rpc-url") ||
    process.env.HIVECASTER_RPC_URL ||
    process.env.STARKNET_RPC_URL ||
    "https://starknet-sepolia.public.blastapi.io";

  return {
    baseUrl,
    rpcUrl,
    walletAddress:
      getFlagValue(allArgs, "--wallet") || process.env.HIVECASTER_WALLET_ADDRESS,
    privateKey:
      getFlagValue(allArgs, "--private-key") || process.env.HIVECASTER_PRIVATE_KEY,
    timeoutMs: parseIntOrDefault(
      getFlagValue(allArgs, "--timeout-ms") || process.env.HIVECASTER_TIMEOUT_MS,
      12_000,
      1_000
    ),
    challengeTtlSecs: parseIntOrDefault(
      getFlagValue(allArgs, "--challenge-ttl-secs") ||
        process.env.HIVECASTER_CHALLENGE_TTL_SECS,
      180,
      30
    ),
    json: hasFlag(allArgs, "--json"),
  };
}

function printOutput(options: SharedOptions, payload: unknown): void {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(payload);
}

async function cmdInit(options: SharedOptions): Promise<void> {
  const [health, contracts, stateMachine] = await Promise.all([
    requestJson(endpoint(options.baseUrl, "/api/health"), { method: "GET" }, options.timeoutMs),
    requestJson(endpoint(options.baseUrl, "/api/network/contracts"), { method: "GET" }, options.timeoutMs),
    requestJson(
      endpoint(options.baseUrl, "/api/network/state-machine?compact=true"),
      { method: "GET" },
      options.timeoutMs
    ),
  ]);

  if (!health.ok) {
    throw new Error(`init failed: /api/health unavailable (${health.status})`);
  }

  const output = {
    ok: true,
    baseUrl: options.baseUrl,
    rpcUrl: options.rpcUrl,
    walletConfigured: !!options.walletAddress && !!options.privateKey,
    endpoints: {
      health: health.ok,
      contracts: contracts.ok,
      stateMachine: stateMachine.ok,
      skill: `${options.baseUrl}/skill.md`,
      openapi: `${options.baseUrl}/api/openapi.json`,
      swagger: `${options.baseUrl}/api/swagger`,
    },
    health: health.json,
    contractsSummary: contracts.ok
      ? {
          count: contracts.json?.count ?? null,
          configuredCount: contracts.json?.configuredCount ?? null,
          network: contracts.json?.network ?? null,
        }
      : null,
    stateMachineSummary: stateMachine.ok
      ? {
          machines: stateMachine.json?.count ?? null,
          schemaUrl: stateMachine.json?.schemaUrl ?? null,
        }
      : null,
  };

  printOutput(options, output);
}

async function cmdRegister(options: SharedOptions, args: string[]): Promise<void> {
  const { account, walletAddress } = buildAccount(options);

  const name =
    getFlagValue(args, "--name") ||
    process.env.HIVECASTER_AGENT_NAME ||
    "HiveCaster Worker";
  const handle =
    getFlagValue(args, "--handle") ||
    process.env.HIVECASTER_AGENT_HANDLE ||
    "hivecaster-worker";
  const id = getFlagValue(args, "--agent-id") || process.env.HIVECASTER_AGENT_ID;
  const description =
    getFlagValue(args, "--description") || process.env.HIVECASTER_AGENT_DESCRIPTION;
  const model =
    getFlagValue(args, "--model") || process.env.HIVECASTER_AGENT_MODEL || "external-agent";
  const endpointUrl =
    getFlagValue(args, "--endpoint-url") || process.env.HIVECASTER_AGENT_ENDPOINT_URL;
  const agentCardUrl =
    getFlagValue(args, "--agent-card-url") || process.env.HIVECASTER_AGENT_CARD_URL;
  const proofUrl =
    getFlagValue(args, "--proof-url") || process.env.HIVECASTER_AGENT_PROOF_URL;
  const topics = parseCsv(
    getFlagValue(args, "--topics") || process.env.HIVECASTER_AGENT_TOPICS
  );
  const budgetStrkRaw =
    getFlagValue(args, "--budget-strk") || process.env.HIVECASTER_AGENT_BUDGET_STRK;
  const maxBetStrkRaw =
    getFlagValue(args, "--max-bet-strk") || process.env.HIVECASTER_AGENT_MAX_BET_STRK;

  const payload = compactObject({
    id,
    walletAddress,
    x402Address: walletAddress,
    name,
    handle,
    description,
    model,
    endpointUrl,
    agentCardUrl,
    proofUrl,
    topics,
    budgetStrk:
      budgetStrkRaw !== undefined
        ? parseFloatOrDefault(budgetStrkRaw, 0)
        : undefined,
    maxBetStrk:
      maxBetStrkRaw !== undefined
        ? parseFloatOrDefault(maxBetStrkRaw, 0)
        : undefined,
    active: parseBool(getFlagValue(args, "--active"), true),
  });

  const result = await signedPost({
    options,
    action: "register_agent",
    path: "/api/network/agents",
    payload,
    walletAddress,
    account,
  });

  if (!result.ok) {
    throw new Error(
      `register failed (HTTP ${result.status}): ${short(
        result.text || JSON.stringify(result.json ?? {})
      )}`
    );
  }

  printOutput(options, {
    ok: true,
    walletAddress,
    agentId: result.json?.agent?.id ?? null,
    existed: result.json?.existed ?? null,
    agent: result.json?.agent ?? null,
  });
}

async function cmdHeartbeat(options: SharedOptions, args: string[]): Promise<void> {
  const { account, walletAddress } = buildAccount(options);
  const agentId =
    getFlagValue(args, "--agent-id") || process.env.HIVECASTER_AGENT_ID;
  if (!agentId) {
    throw new Error("agent id is required (--agent-id or HIVECASTER_AGENT_ID)");
  }

  const payload = compactObject({
    agentId,
    walletAddress,
    active: parseBool(getFlagValue(args, "--active"), true),
    endpointUrl:
      getFlagValue(args, "--endpoint-url") || process.env.HIVECASTER_AGENT_ENDPOINT_URL,
    runtime: compactObject({
      nodeId:
        getFlagValue(args, "--runtime-node-id") ||
        process.env.HIVECASTER_RUNTIME_NODE_ID ||
        os.hostname(),
      provider:
        getFlagValue(args, "--runtime-provider") ||
        process.env.HIVECASTER_RUNTIME_PROVIDER ||
        "independent-node",
      region:
        getFlagValue(args, "--runtime-region") ||
        process.env.HIVECASTER_RUNTIME_REGION,
      scheduler:
        getFlagValue(args, "--runtime-scheduler") ||
        process.env.HIVECASTER_RUNTIME_SCHEDULER ||
        "self",
      version:
        getFlagValue(args, "--runtime-version") ||
        process.env.HIVECASTER_RUNTIME_VERSION,
    }),
  });

  const result = await signedPost({
    options,
    action: "heartbeat_agent",
    path: "/api/network/heartbeat",
    payload,
    walletAddress,
    account,
  });

  if (!result.ok) {
    throw new Error(
      `heartbeat failed (HTTP ${result.status}): ${short(
        result.text || JSON.stringify(result.json ?? {})
      )}`
    );
  }

  printOutput(options, {
    ok: true,
    heartbeat: result.json?.heartbeat ?? null,
    presence: result.json?.presence ?? null,
  });
}

async function cmdForecast(options: SharedOptions, args: string[]): Promise<void> {
  const { account, walletAddress } = buildAccount(options);
  const agentId =
    getFlagValue(args, "--agent-id") || process.env.HIVECASTER_AGENT_ID;
  if (!agentId) {
    throw new Error("agent id is required (--agent-id or HIVECASTER_AGENT_ID)");
  }
  const marketIdRaw = getFlagValue(args, "--market-id");
  if (!marketIdRaw) {
    throw new Error("market id is required (--market-id)");
  }
  const probabilityRaw = getFlagValue(args, "--probability");
  if (!probabilityRaw) {
    throw new Error("probability is required (--probability)");
  }

  const marketId = Number.parseInt(marketIdRaw, 10);
  if (!Number.isFinite(marketId) || marketId < 0) {
    throw new Error("--market-id must be a non-negative integer");
  }
  const probability = Number.parseFloat(probabilityRaw);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("--probability must be a number between 0 and 1");
  }

  const payload = compactObject({
    actorType: "agent",
    agentId,
    actorName:
      getFlagValue(args, "--actor-name") ||
      process.env.HIVECASTER_AGENT_NAME ||
      "HiveCaster Worker",
    walletAddress,
    kind: "forecast",
    marketId,
    probability,
    content: getFlagValue(args, "--content") || process.env.HIVECASTER_FORECAST_CONTENT,
    sources: parseCsv(getFlagValue(args, "--sources") || process.env.HIVECASTER_FORECAST_SOURCES),
  });

  const result = await signedPost({
    options,
    action: "post_contribution",
    path: "/api/network/contributions",
    payload,
    walletAddress,
    account,
  });

  if (!result.ok) {
    throw new Error(
      `forecast post failed (HTTP ${result.status}): ${short(
        result.text || JSON.stringify(result.json ?? {})
      )}`
    );
  }

  printOutput(options, {
    ok: true,
    contributionId: result.json?.contribution?.id ?? null,
    activityType: result.json?.activityType ?? null,
    contribution: result.json?.contribution ?? null,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    usage();
    return;
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);
  const options = parseSharedOptions(argv);

  if (command === "init") {
    await cmdInit(options);
    return;
  }
  if (command === "register") {
    await cmdRegister(options, commandArgs);
    return;
  }
  if (command === "heartbeat") {
    await cmdHeartbeat(options, commandArgs);
    return;
  }
  if (command === "forecast") {
    await cmdForecast(options, commandArgs);
    return;
  }

  throw new Error(`unknown command '${command}'`);
}

main().catch((err: any) => {
  const message = err?.message ?? String(err);
  console.error(`[hivecaster-cli] ${message}`);
  process.exitCode = 1;
});
