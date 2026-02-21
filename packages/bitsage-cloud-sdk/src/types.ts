/**
 * BitsagE Cloud SDK — Types & Pricing Constants
 */

export type MachineTier = "nano" | "micro" | "small";
export type MachineStatus = "starting" | "running" | "stopping" | "dead";

export interface Machine {
  id: string;
  flyMachineId: string;
  agentAddress: string;
  tier: MachineTier;
  status: MachineStatus;
  createdAt: string;
  lastHeartbeat?: string;
  /** Total STRK deducted (as wei string for bigint safety). */
  deductedTotal: string;
}

export interface MachineConfig {
  agentAddress: string;
  tier: MachineTier;
  /** Extra environment variables injected into the Fly.io machine. */
  envVars?: Record<string, string>;
}

export interface CreditBalance {
  agentAddress: string;
  /** Human-readable STRK amount (e.g. "100.5"). */
  balanceStrk: string;
  /** Balance in wei as string (bigint-safe). */
  balanceWei: string;
  /** Estimated compute hours remaining at each tier. */
  estimatedHoursRemaining: Record<MachineTier, number>;
}

export interface HeartbeatResult {
  ok: boolean;
  /** Remaining balance in wei as string. */
  remainingWei?: string;
  /** Set to true if the machine was terminated due to insufficient balance. */
  terminated?: boolean;
  error?: string;
}

/**
 * Pricing constants for BitsagE Cloud machine tiers.
 * These are intentionally conservative rates for the initial launch.
 */
export const MACHINE_PRICING: Record<MachineTier, { strkPerHour: number; description: string }> = {
  nano:  { strkPerHour: 0.05, description: "shared-cpu-1x, 256MB — lightweight agents" },
  micro: { strkPerHour: 0.10, description: "shared-cpu-1x, 512MB — standard agents" },
  small: { strkPerHour: 0.25, description: "shared-cpu-2x, 1GB  — compute-intensive agents" },
};

export const HEARTBEAT_INTERVAL_SECS = 60;

/**
 * Hourly cost per tier expressed as exact integer micro-STRK (1 µSTRK = 1e-6 STRK = 1e12 wei).
 * Using a lookup table avoids any floating-point arithmetic in pricing logic.
 *
 *   nano:  0.05 STRK/hr =  50_000 µSTRK/hr
 *   micro: 0.10 STRK/hr = 100_000 µSTRK/hr
 *   small: 0.25 STRK/hr = 250_000 µSTRK/hr
 */
const HOURLY_MICRO_STRK: Record<MachineTier, bigint> = {
  nano:   50_000n,
  micro: 100_000n,
  small: 250_000n,
};

/**
 * Exact wei cost for a single heartbeat interval at the given tier.
 * Computed with pure BigInt arithmetic — no floating-point rounding errors.
 *
 *   cost_wei = (µSTRK/hr × 1e12 wei/µSTRK × INTERVAL_SECS) / 3600
 */
export function heartbeatCostWei(tier: MachineTier): bigint {
  const WEI_PER_MICRO_STRK = 1_000_000_000_000n; // 1e12
  return (HOURLY_MICRO_STRK[tier] * WEI_PER_MICRO_STRK * BigInt(HEARTBEAT_INTERVAL_SECS)) / 3600n;
}

/**
 * Exact wei cost for one full hour at the given tier (for upfront balance checks).
 */
export function hourlyRateWei(tier: MachineTier): bigint {
  return heartbeatCostWei(tier) * BigInt(3600 / HEARTBEAT_INTERVAL_SECS);
}

/** Custom error: agent has insufficient STRK balance in escrow. */
export class BitsageInsufficientBalanceError extends Error {
  constructor(message = "Insufficient STRK balance in BitsagE escrow") {
    super(message);
    this.name = "BitsageInsufficientBalanceError";
  }
}
