import { describe, expect, it } from "vitest";
import {
  resolveAgentPrivateKey,
  storeAgentPrivateKey,
} from "./agent-key-custody";

describe("agent-key-custody", () => {
  it("stores and resolves agent keys with memory custody", async () => {
    const agentId = `test_agent_${Date.now()}`;
    const privateKey = "0x1234abcd";
    const stored = await storeAgentPrivateKey({
      agentId,
      walletAddress: "0xabc123",
      privateKey,
    });

    expect(stored.keyRef).toContain(agentId);
    const resolved = await resolveAgentPrivateKey({
      id: agentId,
      keyRef: stored.keyRef,
      privateKey: undefined,
    });

    expect(resolved).toBe(privateKey);
  });
});

