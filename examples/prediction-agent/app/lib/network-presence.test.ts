import { afterEach, describe, expect, it } from "vitest";
import {
  getNetworkPresencePolicy,
  resolveNetworkAgentPresence,
} from "./network-presence";
import type { PersistedNetworkAgentProfile } from "./state-store";

const OLD_ONLINE = process.env.NETWORK_AGENT_ONLINE_TTL_SECS;
const OLD_STALE = process.env.NETWORK_AGENT_STALE_TTL_SECS;

function makeAgent(overrides?: Partial<PersistedNetworkAgentProfile>): PersistedNetworkAgentProfile {
  return {
    id: "agent_1",
    walletAddress: "0x1",
    name: "Agent One",
    active: true,
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  if (OLD_ONLINE === undefined) {
    delete process.env.NETWORK_AGENT_ONLINE_TTL_SECS;
  } else {
    process.env.NETWORK_AGENT_ONLINE_TTL_SECS = OLD_ONLINE;
  }

  if (OLD_STALE === undefined) {
    delete process.env.NETWORK_AGENT_STALE_TTL_SECS;
  } else {
    process.env.NETWORK_AGENT_STALE_TTL_SECS = OLD_STALE;
  }
});

describe("network-presence", () => {
  it("resolves online/stale/offline/inactive states", () => {
    const now = 10_000;
    const online = resolveNetworkAgentPresence({
      agent: makeAgent({ lastSeenAt: 9_500 }),
      now,
      onlineTtlMs: 1_000,
      staleTtlMs: 5_000,
    });
    expect(online.status).toBe("online");
    expect(online.isOnline).toBe(true);

    const stale = resolveNetworkAgentPresence({
      agent: makeAgent({ lastSeenAt: 7_500 }),
      now,
      onlineTtlMs: 1_000,
      staleTtlMs: 5_000,
    });
    expect(stale.status).toBe("stale");
    expect(stale.isOnline).toBe(false);

    const offline = resolveNetworkAgentPresence({
      agent: makeAgent({ lastSeenAt: 3_000 }),
      now,
      onlineTtlMs: 1_000,
      staleTtlMs: 5_000,
    });
    expect(offline.status).toBe("offline");

    const inactive = resolveNetworkAgentPresence({
      agent: makeAgent({ active: false, lastSeenAt: 9_500 }),
      now,
      onlineTtlMs: 1_000,
      staleTtlMs: 5_000,
    });
    expect(inactive.status).toBe("inactive");
  });

  it("parses presence policy from env", () => {
    process.env.NETWORK_AGENT_ONLINE_TTL_SECS = "90";
    process.env.NETWORK_AGENT_STALE_TTL_SECS = "360";
    const policy = getNetworkPresencePolicy();
    expect(policy.onlineTtlMs).toBe(90_000);
    expect(policy.staleTtlMs).toBe(360_000);
  });
});
