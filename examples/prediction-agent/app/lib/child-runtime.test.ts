import { describe, expect, it } from "vitest";
import {
  buildChildServerEnv,
  parseRegionPolicy,
  selectFailoverRegions,
  shouldHeartbeatChildServer,
  shouldAttemptRuntimeFailover,
} from "./child-runtime";

describe("child-runtime helpers", () => {
  it("heartbeats only on configured tick intervals", () => {
    expect(shouldHeartbeatChildServer(1, 3)).toBe(false);
    expect(shouldHeartbeatChildServer(2, 3)).toBe(false);
    expect(shouldHeartbeatChildServer(3, 3)).toBe(true);
    expect(shouldHeartbeatChildServer(6, 3)).toBe(true);
    expect(shouldHeartbeatChildServer(0, 3)).toBe(false);
  });

  it("builds child server env with core child credentials", () => {
    const env = buildChildServerEnv({
      childAgentId: "spawned_test_01",
      childName: "AlphaChild-01",
      childAddress: "0xabc",
      childPrivateKey: "0x123",
      parentAddress: "0xparent",
    });

    expect(env.AGENT_ADDRESS).toBe("0xabc");
    expect(env.AGENT_PRIVATE_KEY).toBe("0x123");
    expect(env.CHILD_AGENT_ID).toBe("spawned_test_01");
    expect(env.CHILD_AGENT_NAME).toBe("AlphaChild-01");
    expect(env.CHILD_AGENT_SELF_SCHEDULER_ENABLED).toBe("true");
    expect(env.PARENT_AGENT_ADDRESS).toBe("0xparent");
    expect(env.STARKNET_RPC_URL).toBeTruthy();
    expect(env.MARKET_FACTORY_ADDRESS).toBeTruthy();
  });

  it("parses region policy from csv", () => {
    expect(parseRegionPolicy("iad, sfo , fra")).toEqual(["iad", "sfo", "fra"]);
    expect(parseRegionPolicy(" , , ")).toEqual([]);
  });

  it("attempts failover only after threshold and cooldown", () => {
    const now = Date.now();
    expect(
      shouldAttemptRuntimeFailover({
        consecutiveFailures: 3,
        failoverCount: 1,
        lastFailoverAt: now - 181_000,
        nowMs: now,
      })
    ).toBe(true);

    expect(
      shouldAttemptRuntimeFailover({
        consecutiveFailures: 1,
        failoverCount: 1,
        lastFailoverAt: now - 181_000,
        nowMs: now,
      })
    ).toBe(false);

    expect(
      shouldAttemptRuntimeFailover({
        consecutiveFailures: 3,
        failoverCount: 1,
        lastFailoverAt: now - 60_000,
        nowMs: now,
      })
    ).toBe(false);
  });

  it("prioritizes non-quarantined regions during failover", () => {
    const now = Date.now();
    const selected = selectFailoverRegions({
      regions: ["iad", "sfo", "fra"],
      currentRegion: "iad",
      regionFailureLog: [
        { region: "sfo", failedAt: now - 30_000 },
        { region: "fra", failedAt: now - 700_000 },
      ],
      quarantineSecs: 600,
      nowMs: now,
    });

    // Rotation from iad would be sfo -> fra -> iad, but sfo is quarantined.
    expect(selected).toEqual(["fra", "iad"]);
  });

  it("falls back to full order when all regions are quarantined", () => {
    const now = Date.now();
    const selected = selectFailoverRegions({
      regions: ["iad", "sfo"],
      currentRegion: "iad",
      regionFailureLog: [
        { region: "sfo", failedAt: now - 10_000 },
        { region: "iad", failedAt: now - 20_000 },
      ],
      quarantineSecs: 600,
      nowMs: now,
    });

    expect(selected).toEqual(["sfo", "iad"]);
  });
});
