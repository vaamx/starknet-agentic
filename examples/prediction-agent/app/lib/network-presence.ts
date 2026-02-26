import type { PersistedNetworkAgentProfile } from "./state-store";

export type NetworkAgentPresenceStatus =
  | "online"
  | "stale"
  | "offline"
  | "inactive";

function parseTtlSeconds(
  value: string | undefined,
  fallback: number,
  minValue: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, parsed);
}

export function getNetworkPresencePolicy(): {
  onlineTtlMs: number;
  staleTtlMs: number;
} {
  const onlineTtlSecs = parseTtlSeconds(
    process.env.NETWORK_AGENT_ONLINE_TTL_SECS,
    180,
    15
  );
  const staleTtlSecs = parseTtlSeconds(
    process.env.NETWORK_AGENT_STALE_TTL_SECS,
    onlineTtlSecs * 5,
    onlineTtlSecs
  );

  return {
    onlineTtlMs: onlineTtlSecs * 1000,
    staleTtlMs: staleTtlSecs * 1000,
  };
}

export function resolveNetworkAgentPresence(args: {
  agent: PersistedNetworkAgentProfile;
  now?: number;
  onlineTtlMs?: number;
  staleTtlMs?: number;
}): {
  status: NetworkAgentPresenceStatus;
  isOnline: boolean;
  ageMs: number | null;
  lastSeenAt: number;
} {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  const { onlineTtlMs, staleTtlMs } =
    args.onlineTtlMs !== undefined && args.staleTtlMs !== undefined
      ? { onlineTtlMs: args.onlineTtlMs, staleTtlMs: args.staleTtlMs }
      : getNetworkPresencePolicy();
  const lastSeenAt = Number.isFinite(args.agent.lastSeenAt)
    ? args.agent.lastSeenAt
    : 0;

  if (!args.agent.active) {
    return {
      status: "inactive",
      isOnline: false,
      ageMs: lastSeenAt > 0 ? Math.max(0, now - lastSeenAt) : null,
      lastSeenAt,
    };
  }

  if (lastSeenAt <= 0) {
    return {
      status: "offline",
      isOnline: false,
      ageMs: null,
      lastSeenAt,
    };
  }

  const ageMs = Math.max(0, now - lastSeenAt);
  if (ageMs <= onlineTtlMs) {
    return {
      status: "online",
      isOnline: true,
      ageMs,
      lastSeenAt,
    };
  }
  if (ageMs <= staleTtlMs) {
    return {
      status: "stale",
      isOnline: false,
      ageMs,
      lastSeenAt,
    };
  }
  return {
    status: "offline",
    isOnline: false,
    ageMs,
    lastSeenAt,
  };
}
