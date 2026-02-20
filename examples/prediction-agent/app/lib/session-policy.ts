import { config } from "./config";

export interface SessionPolicyInput {
  validAfter: number;
  validUntil: number;
  spendingLimitWei: bigint;
  spendingToken: string;
  allowedContract: string;
  maxCallsPerTx: number;
  spendingPeriodSecs: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStrkToWei(value: string | undefined, fallbackStrk: number): bigint {
  const parsed = value ? Number(value) : fallbackStrk;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return BigInt(Math.round(fallbackStrk * 1e18));
  }
  return BigInt(Math.round(parsed * 1e18));
}

function normalizeAddress(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value;
}

export function buildSessionPolicyInput(
  overrides?: Partial<SessionPolicyInput>
): SessionPolicyInput {
  const nowSec = Math.floor(Date.now() / 1000);
  const defaultValidAfter = nowSec - 60;
  const defaultValidUntil = nowSec + 7 * 86_400;

  const validAfter = overrides?.validAfter ?? parseNumber(config.AGENT_SESSION_VALID_AFTER, defaultValidAfter);
  let validUntil = overrides?.validUntil ?? parseNumber(config.AGENT_SESSION_VALID_UNTIL, defaultValidUntil);
  if (validUntil <= validAfter) {
    validUntil = validAfter + 3600;
  }

  const spendingLimitWei = overrides?.spendingLimitWei
    ?? parseStrkToWei(config.AGENT_SESSION_SPENDING_LIMIT_STRK, 200);

  const spendingToken = overrides?.spendingToken
    ?? normalizeAddress(config.AGENT_SESSION_SPENDING_TOKEN, config.COLLATERAL_TOKEN_ADDRESS);

  const allowedContract = overrides?.allowedContract
    ?? normalizeAddress(config.AGENT_SESSION_ALLOWED_CONTRACT, "0x0");

  const maxCallsPerTx = overrides?.maxCallsPerTx
    ?? parseNumber(config.AGENT_SESSION_MAX_CALLS, 5);

  const spendingPeriodSecs = overrides?.spendingPeriodSecs
    ?? parseNumber(config.AGENT_SESSION_SPENDING_PERIOD_SECS, 86_400);

  return {
    validAfter,
    validUntil,
    spendingLimitWei,
    spendingToken,
    allowedContract,
    maxCallsPerTx,
    spendingPeriodSecs,
  };
}

export function toSessionPolicyCalldata(policy: SessionPolicyInput) {
  return {
    valid_after: policy.validAfter,
    valid_until: policy.validUntil,
    spending_limit: { low: policy.spendingLimitWei, high: 0n },
    spending_token: policy.spendingToken,
    allowed_contract: policy.allowedContract,
    max_calls_per_tx: policy.maxCallsPerTx,
    spending_period_secs: policy.spendingPeriodSecs,
  };
}

export function hasSessionKeyConfigured(): boolean {
  return !!(config.AGENT_SESSION_PRIVATE_KEY && config.AGENT_SESSION_PUBLIC_KEY);
}
