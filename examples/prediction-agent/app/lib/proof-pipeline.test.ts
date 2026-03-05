import { describe, expect, it } from "vitest";
import {
  createProofRecord,
  getExplorerTxUrl,
  getProofRecord,
} from "./proof-pipeline";

describe("proof-pipeline", () => {
  it("creates a local proof record without anchoring", async () => {
    const id = `proof_test_${Date.now()}`;
    const proof = await createProofRecord({
      id,
      kind: "custom",
      payload: {
        hello: "world",
        n: 1,
      },
      anchor: false,
    });

    expect(proof.id).toBe(id);
    expect(proof.payloadHash).toHaveLength(64);
    expect(proof.anchor).toBeUndefined();

    const fetched = await getProofRecord(id);
    expect(fetched?.id).toBe(id);
  });

  it("builds voyager explorer links for Starknet tx hashes", () => {
    const url = getExplorerTxUrl("0x1234");
    expect(url).toContain("/tx/0x1234");
  });
});

