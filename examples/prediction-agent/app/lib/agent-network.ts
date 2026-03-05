import { createHash } from "node:crypto";

export function normalizeWalletAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isStarknetAddress(value: string): boolean {
  const normalized = normalizeWalletAddress(value);
  return /^0x[0-9a-f]{1,64}$/i.test(normalized);
}

export function slugifyHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 48);
}

export function buildNetworkAgentId(walletAddress: string, handle: string): string {
  const wallet = normalizeWalletAddress(walletAddress);
  const slug = slugifyHandle(handle || "agent");
  return `${wallet}:${slug || "agent"}`;
}

export function buildContributionId(seed: {
  actorName: string;
  walletAddress?: string;
  marketId?: number;
  kind: string;
  createdAt: number;
  content?: string;
}): string {
  const hash = createHash("sha256")
    .update(seed.actorName)
    .update("|")
    .update(seed.walletAddress ?? "")
    .update("|")
    .update(String(seed.marketId ?? ""))
    .update("|")
    .update(seed.kind)
    .update("|")
    .update(String(seed.createdAt))
    .update("|")
    .update(seed.content ?? "")
    .digest("hex")
    .slice(0, 16);
  return `net_${seed.createdAt}_${hash}`;
}
