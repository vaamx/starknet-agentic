import type { AgentPrediction } from "./types";

export function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function computeDisagreement(preds: AgentPrediction[]): number {
  if (preds.length === 0) return 0;
  const mean = preds.reduce((sum, p) => sum + p.predictedProb, 0) / preds.length;
  const variance =
    preds.reduce((sum, p) => sum + (p.predictedProb - mean) ** 2, 0) /
    preds.length;
  return Math.sqrt(variance);
}

export function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function formatVolume(markets: { totalPool: string }[]): string {
  const weiTotal = markets.reduce((sum, m) => sum + safeBigInt(m.totalPool), 0n);
  const whole = weiTotal / 10n ** 18n;
  if (whole >= 1000n) {
    const tenthK = Number((whole * 10n) / 1000n) / 10;
    return `${tenthK.toFixed(1)}K STRK`;
  }
  return `${whole.toString()} STRK`;
}
