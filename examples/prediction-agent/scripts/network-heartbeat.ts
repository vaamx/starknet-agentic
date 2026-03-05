#!/usr/bin/env tsx

import os from "node:os";
import process from "node:process";
import { Account, RpcProvider, stark, type TypedData } from "starknet";

type JsonMap = Record<string, unknown>;

interface Options {
  baseUrl: string;
  rpcUrl: string;
  walletAddress: string;
  privateKey: string;
  agentId?: string;
  active: boolean;
  endpointUrl?: string;
  runtimeProvider: string;
  runtimeRegion?: string;
  runtimeScheduler?: string;
  runtimeVersion?: string;
  runtimeNodeId: string;
  runtimeMetadata?: Record<string, string>;
  intervalMs: number;
  jitterMs: number;
  challengeTtlSecs: number;
  timeoutMs: number;
  once: boolean;
  quiet: boolean;
}

function usage(): void {
  console.log(`Usage: tsx scripts/network-heartbeat.ts [options]

Signed liveness worker for independently hosted network agents.

Required env:
  NETWORK_HEARTBEAT_WALLET_ADDRESS   Agent owner wallet address (0x...)
  NETWORK_HEARTBEAT_PRIVATE_KEY      Private key for signing auth challenges

Common env:
  NETWORK_HEARTBEAT_BASE_URL         API base URL (default: http://localhost:3001)
  NETWORK_HEARTBEAT_AGENT_ID         Registered agent id (auto-detected if omitted and unique)
  NETWORK_HEARTBEAT_INTERVAL_MS      Loop interval (default: 60000)
  NETWORK_HEARTBEAT_JITTER_MS        Random +/- jitter (default: 5000)
  NETWORK_HEARTBEAT_ENDPOINT_URL     Agent endpoint for inbound jobs

Options:
  --base-url <url>                   Override API base URL
  --rpc-url <url>                    Starknet RPC for local signing account
  --wallet <0x...>                   Wallet address
  --private-key <0x...>              Private key
  --agent-id <id>                    Registered network agent id
  --interval-ms <ms>                 Heartbeat interval (default: 60000)
  --jitter-ms <ms>                   Random +/- jitter per interval (default: 5000)
  --challenge-ttl-secs <sec>         Auth challenge ttl (default: 180)
  --timeout-ms <ms>                  Request timeout (default: 10000)
  --endpoint-url <url>               Runtime endpoint URL
  --runtime-provider <name>          Runtime provider tag (default: independent-node)
  --runtime-region <name>            Runtime region tag (optional)
  --runtime-scheduler <name>         Runtime scheduler tag (default: self)
  --runtime-version <ver>            Runtime version tag (optional)
  --runtime-node-id <id>             Runtime node id (default: hostname)
  --runtime-metadata-json <json>     Runtime metadata JSON object
  --inactive                         Send active=false in heartbeat payload
  --once                             Send one heartbeat then exit
  --quiet                            Reduce logs
  -h, --help                         Show this help
`);
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const next = String(value ?? "").trim();
  if (!next) {
    throw new Error(`${label} is required`);
  }
  return next;
}

function parseIntOrDefault(
  value: string | undefined,
  fallback: number,
  min: number
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const next = value.trim().toLowerCase();
  if (!next) return fallback;
  return !["0", "false", "no", "off"].includes(next);
}

function parseMetadata(value: string | undefined): Record<string, string> | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`NETWORK_HEARTBEAT_RUNTIME_METADATA_JSON is invalid JSON: ${err?.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("NETWORK_HEARTBEAT_RUNTIME_METADATA_JSON must be a JSON object");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as JsonMap)) {
    if (!key.trim()) continue;
    out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  return parsed.toString().replace(/\/+$/, "");
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const nested = compactObject(entry as Record<string, unknown>);
      if (Object.keys(nested).length === 0) continue;
      out[key] = nested;
      continue;
    }
    out[key] = entry;
  }
  return out as T;
}

function parseArgs(argv: string[]): Options {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }

  const options: Options = {
    baseUrl: normalizeBaseUrl(
      process.env.NETWORK_HEARTBEAT_BASE_URL || "http://localhost:3001"
    ),
    rpcUrl:
      process.env.NETWORK_HEARTBEAT_RPC_URL ||
      process.env.STARKNET_RPC_URL ||
      "https://starknet-sepolia.public.blastapi.io",
    walletAddress: String(process.env.NETWORK_HEARTBEAT_WALLET_ADDRESS ?? "")
      .trim()
      .toLowerCase(),
    privateKey: String(process.env.NETWORK_HEARTBEAT_PRIVATE_KEY ?? "").trim(),
    agentId: process.env.NETWORK_HEARTBEAT_AGENT_ID?.trim() || undefined,
    active: parseBool(process.env.NETWORK_HEARTBEAT_ACTIVE, true),
    endpointUrl: process.env.NETWORK_HEARTBEAT_ENDPOINT_URL?.trim() || undefined,
    runtimeProvider:
      process.env.NETWORK_HEARTBEAT_RUNTIME_PROVIDER?.trim() || "independent-node",
    runtimeRegion: process.env.NETWORK_HEARTBEAT_RUNTIME_REGION?.trim() || undefined,
    runtimeScheduler:
      process.env.NETWORK_HEARTBEAT_RUNTIME_SCHEDULER?.trim() || "self",
    runtimeVersion: process.env.NETWORK_HEARTBEAT_RUNTIME_VERSION?.trim() || undefined,
    runtimeNodeId:
      process.env.NETWORK_HEARTBEAT_RUNTIME_NODE_ID?.trim() || os.hostname(),
    runtimeMetadata: parseMetadata(process.env.NETWORK_HEARTBEAT_RUNTIME_METADATA_JSON),
    intervalMs: parseIntOrDefault(process.env.NETWORK_HEARTBEAT_INTERVAL_MS, 60_000, 2_000),
    jitterMs: parseIntOrDefault(process.env.NETWORK_HEARTBEAT_JITTER_MS, 5_000, 0),
    challengeTtlSecs: parseIntOrDefault(
      process.env.NETWORK_HEARTBEAT_CHALLENGE_TTL_SECS,
      180,
      30
    ),
    timeoutMs: parseIntOrDefault(process.env.NETWORK_HEARTBEAT_TIMEOUT_MS, 10_000, 1_000),
    once: parseBool(process.env.NETWORK_HEARTBEAT_ONCE, false),
    quiet: parseBool(process.env.NETWORK_HEARTBEAT_QUIET, false),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      options.baseUrl = normalizeBaseUrl(requireNonEmpty(argv[++i], "--base-url"));
      continue;
    }
    if (arg === "--rpc-url") {
      options.rpcUrl = requireNonEmpty(argv[++i], "--rpc-url");
      continue;
    }
    if (arg === "--wallet") {
      options.walletAddress = requireNonEmpty(argv[++i], "--wallet").toLowerCase();
      continue;
    }
    if (arg === "--private-key") {
      options.privateKey = requireNonEmpty(argv[++i], "--private-key");
      continue;
    }
    if (arg === "--agent-id") {
      options.agentId = requireNonEmpty(argv[++i], "--agent-id");
      continue;
    }
    if (arg === "--interval-ms") {
      options.intervalMs = parseIntOrDefault(argv[++i], options.intervalMs, 2_000);
      continue;
    }
    if (arg === "--jitter-ms") {
      options.jitterMs = parseIntOrDefault(argv[++i], options.jitterMs, 0);
      continue;
    }
    if (arg === "--challenge-ttl-secs") {
      options.challengeTtlSecs = parseIntOrDefault(argv[++i], options.challengeTtlSecs, 30);
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parseIntOrDefault(argv[++i], options.timeoutMs, 1_000);
      continue;
    }
    if (arg === "--endpoint-url") {
      options.endpointUrl = requireNonEmpty(argv[++i], "--endpoint-url");
      continue;
    }
    if (arg === "--runtime-provider") {
      options.runtimeProvider = requireNonEmpty(argv[++i], "--runtime-provider");
      continue;
    }
    if (arg === "--runtime-region") {
      options.runtimeRegion = requireNonEmpty(argv[++i], "--runtime-region");
      continue;
    }
    if (arg === "--runtime-scheduler") {
      options.runtimeScheduler = requireNonEmpty(argv[++i], "--runtime-scheduler");
      continue;
    }
    if (arg === "--runtime-version") {
      options.runtimeVersion = requireNonEmpty(argv[++i], "--runtime-version");
      continue;
    }
    if (arg === "--runtime-node-id") {
      options.runtimeNodeId = requireNonEmpty(argv[++i], "--runtime-node-id");
      continue;
    }
    if (arg === "--runtime-metadata-json") {
      options.runtimeMetadata = parseMetadata(requireNonEmpty(argv[++i], "--runtime-metadata-json"));
      continue;
    }
    if (arg === "--inactive") {
      options.active = false;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  options.walletAddress = requireNonEmpty(
    options.walletAddress,
    "NETWORK_HEARTBEAT_WALLET_ADDRESS (or --wallet)"
  ).toLowerCase();
  options.privateKey = requireNonEmpty(
    options.privateKey,
    "NETWORK_HEARTBEAT_PRIVATE_KEY (or --private-key)"
  );

  return options;
}

function endpoint(baseUrl: string, pathname: string): string {
  return `${baseUrl}${pathname}`;
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function short(text: string, max = 240): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

async function resolveAgentId(
  options: Options
): Promise<string> {
  if (options.agentId) return options.agentId;

  const url = endpoint(
    options.baseUrl,
    `/api/network/agents?wallet=${encodeURIComponent(options.walletAddress)}&limit=100`
  );
  const lookup = await requestJson(
    url,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
    options.timeoutMs
  );
  if (!lookup.ok) {
    throw new Error(
      `Failed to auto-resolve agent id (GET /api/network/agents HTTP ${lookup.status}): ${short(
        lookup.text || JSON.stringify(lookup.json ?? {})
      )}`
    );
  }

  const agents = Array.isArray(lookup.json?.agents) ? lookup.json.agents : [];
  if (agents.length === 1 && typeof agents[0]?.id === "string") {
    return String(agents[0].id);
  }
  if (agents.length === 0) {
    throw new Error(
      "No registered agent found for this wallet. Register first via /api/network/agents, then set NETWORK_HEARTBEAT_AGENT_ID."
    );
  }

  const ids = agents
    .map((entry: any) => (typeof entry?.id === "string" ? entry.id : null))
    .filter(Boolean)
    .join(", ");
  throw new Error(
    `Multiple agents found for this wallet (${ids}). Set NETWORK_HEARTBEAT_AGENT_ID explicitly.`
  );
}

function buildHeartbeatPayload(options: Options, agentId: string): JsonMap {
  const runtime = compactObject({
    nodeId: options.runtimeNodeId,
    provider: options.runtimeProvider,
    region: options.runtimeRegion,
    scheduler: options.runtimeScheduler,
    intervalMs: options.intervalMs,
    version: options.runtimeVersion,
    endpointUrl: options.endpointUrl,
    metadata: options.runtimeMetadata,
  });

  return compactObject({
    agentId,
    walletAddress: options.walletAddress,
    active: options.active,
    endpointUrl: options.endpointUrl,
    runtime: Object.keys(runtime).length > 0 ? runtime : undefined,
  });
}

async function signChallenge(
  options: Options,
  account: Account,
  payload: JsonMap
): Promise<{ challengeId: string; signature: string[] }> {
  const challengeReq = await requestJson(
    endpoint(options.baseUrl, "/api/network/auth/challenge"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: "heartbeat_agent",
        walletAddress: options.walletAddress,
        payload,
        ttlSecs: options.challengeTtlSecs,
      }),
    },
    options.timeoutMs
  );

  if (!challengeReq.ok) {
    throw new Error(
      `Challenge request failed (HTTP ${challengeReq.status}): ${short(
        challengeReq.text || JSON.stringify(challengeReq.json ?? {})
      )}`
    );
  }

  const challenge = challengeReq.json?.challenge;
  if (!challenge?.id || !challenge?.typedData) {
    throw new Error("Challenge response missing challenge.id or challenge.typedData");
  }

  const signature = stark
    .formatSignature(await account.signMessage(challenge.typedData as TypedData))
    .map((value) => String(value));
  if (!Array.isArray(signature) || signature.length < 2) {
    throw new Error("Failed to produce Starknet signature for heartbeat challenge");
  }

  return {
    challengeId: String(challenge.id),
    signature,
  };
}

async function sendHeartbeat(options: Options, account: Account, agentId: string): Promise<{
  status: string;
  heartbeatCount: number;
  lastHeartbeatAt?: number;
}> {
  const payload = buildHeartbeatPayload(options, agentId);
  const signed = await signChallenge(options, account, payload);
  const requestBody = {
    ...payload,
    auth: {
      challengeId: signed.challengeId,
      walletAddress: options.walletAddress,
      signature: signed.signature,
    },
  };

  const heartbeatReq = await requestJson(
    endpoint(options.baseUrl, "/api/network/heartbeat"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    options.timeoutMs
  );

  if (!heartbeatReq.ok) {
    throw new Error(
      `Heartbeat request failed (HTTP ${heartbeatReq.status}): ${short(
        heartbeatReq.text || JSON.stringify(heartbeatReq.json ?? {})
      )}`
    );
  }

  return {
    status: String(heartbeatReq.json?.presence?.status ?? "unknown"),
    heartbeatCount: Number(heartbeatReq.json?.heartbeat?.heartbeatCount ?? 0),
    lastHeartbeatAt:
      typeof heartbeatReq.json?.heartbeat?.lastHeartbeatAt === "number"
        ? heartbeatReq.json.heartbeat.lastHeartbeatAt
        : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const provider = new RpcProvider({ nodeUrl: options.rpcUrl });
  const account = new Account({
    provider,
    address: options.walletAddress,
    signer: options.privateKey,
  });
  const agentId = await resolveAgentId(options);

  let stopping = false;
  const onSignal = (signal: string) => {
    if (!options.quiet) {
      console.log(`[heartbeat] received ${signal}, shutting down...`);
    }
    stopping = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  if (!options.quiet) {
    console.log(
      `[heartbeat] starting worker base=${options.baseUrl} agentId=${agentId} interval=${options.intervalMs}ms jitter=+/-${options.jitterMs}ms once=${options.once}`
    );
  }

  do {
    const startedAt = Date.now();
    try {
      const result = await sendHeartbeat(options, account, agentId);
      if (!options.quiet) {
        console.log(
          `[heartbeat] ok status=${result.status} count=${result.heartbeatCount} latency=${Date.now() - startedAt}ms`
        );
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`[heartbeat] error: ${message}`);
      if (options.once) {
        throw err;
      }
    }

    if (options.once || stopping) break;
    const jitter =
      options.jitterMs > 0
        ? Math.floor((Math.random() * (options.jitterMs * 2 + 1)) - options.jitterMs)
        : 0;
    const delayMs = Math.max(1_000, options.intervalMs + jitter);
    await sleep(delayMs);
  } while (!stopping);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[heartbeat] fatal: ${message}`);
  process.exitCode = 1;
});
