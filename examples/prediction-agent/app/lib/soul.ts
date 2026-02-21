/**
 * SOUL.md — Evolving self-description document for the agent.
 *
 * This is an in-memory singleton that survives within a process lifetime.
 * Intentionally resets on cold start — SOUL.md is a session document,
 * not a persistent identity store.
 *
 * GET /api/soul renders the current state as Markdown.
 * External agents (OpenClaw, Daydreams) can fetch it for discovery.
 */

import { config } from "./config";

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SoulChild {
  id: string;
  name: string;
  tier: string;
}

interface SoulState {
  name: string;
  address: string;
  agentId: string;
  network: string;
  deployedAt: string;
  tier: string;
  balanceStrk: number;
  model: string;
  tickCount: number;
  totalPredictions: number;
  totalBets: number;
  avgBrier: number | null;
  currentThesis: string;
  children: SoulChild[];
  huginnAddress: string;
  lastUpdatedAt: string;
}

// ── Module state ─────────────────────────────────────────────────────────────

const soulState: SoulState = {
  name: "BitsageAgent",
  address: config.AGENT_ADDRESS ?? "0x0",
  agentId: config.AGENT_ID ?? "1",
  network: config.STARKNET_CHAIN_ID ?? "SN_SEPOLIA",
  deployedAt: new Date().toISOString(),
  tier: "unknown",
  balanceStrk: 0,
  model: "claude-sonnet-4-6",
  tickCount: 0,
  totalPredictions: 0,
  totalBets: 0,
  avgBrier: null,
  currentThesis: "Initialising…",
  children: [],
  huginnAddress: config.HUGINN_REGISTRY_ADDRESS,
  lastUpdatedAt: new Date().toISOString(),
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Merge a partial update into the soul state. */
export function updateSoul(patch: Partial<SoulState>): void {
  Object.assign(soulState, patch);
  soulState.lastUpdatedAt = new Date().toISOString();
}

/** Increment prediction count by 1. */
export function incrementSoulPredictions(): void {
  soulState.totalPredictions++;
  soulState.lastUpdatedAt = new Date().toISOString();
}

/** Increment bet count by 1. */
export function incrementSoulBets(): void {
  soulState.totalBets++;
  soulState.lastUpdatedAt = new Date().toISOString();
}

/** Get all soul children (for use by runChildSpawn). */
export function getSoulChildren(): SoulChild[] {
  return [...soulState.children];
}

/** Render the current soul state as a Markdown document. */
export function getSoul(): string {
  const s = soulState;

  const tierEmoji: Record<string, string> = {
    thriving: "🟣",
    healthy:  "🟢",
    low:      "🟡",
    critical: "🔴",
    dead:     "⚫",
    unknown:  "⚪",
  };

  const emoji = tierEmoji[s.tier] ?? "⚪";

  const childrenTable =
    s.children.length === 0
      ? "_No children spawned yet._"
      : [
          "| ID | Name | Tier |",
          "|----|------|------|",
          ...s.children.map(
            (c) => `| \`${c.id.slice(0, 12)}…\` | ${c.name} | ${c.tier} |`
          ),
        ].join("\n");

  const huginnLink =
    s.huginnAddress !== "0x0"
      ? `[${s.huginnAddress.slice(0, 20)}…](https://sepolia.starkscan.co/contract/${s.huginnAddress})`
      : "_not configured_";

  const avgBrierStr =
    s.avgBrier !== null ? s.avgBrier.toFixed(4) : "_no data_";

  const networkDisplay =
    s.network === "SN_MAIN" ? "Starknet Mainnet" : "Starknet Sepolia";

  return `# SOUL.md — ${s.name}

## Identity
- **Address**: \`${s.address}\`
- **ERC-8004 ID**: #${s.agentId}
- **Network**: ${networkDisplay}
- **Deployed at**: ${s.deployedAt}

## Survival Status
- **Tier**: ${s.tier} ${emoji}
- **Balance**: ${s.balanceStrk.toFixed(2)} STRK
- **Model**: \`${s.model}\`

## Performance (this session)
- **Ticks**: ${s.tickCount} | **Predictions**: ${s.totalPredictions} | **Bets**: ${s.totalBets}
- **Avg Brier**: ${avgBrierStr}

## Current Thesis
> ${s.currentThesis}

## Children
${childrenTable}

## Provenance
All reasoning is logged on-chain via Huginn Registry: ${huginnLink}

---
*Last updated: ${s.lastUpdatedAt}*
`;
}
