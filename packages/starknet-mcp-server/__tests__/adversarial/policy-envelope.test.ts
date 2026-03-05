import { describe, expect, it } from "vitest";
import { PolicyGuard } from "../../src/middleware/policyGuard.js";
import { normalizeExecutionError } from "../../src/utils/executionError.js";

describe("policy-envelope adversarial harness", () => {
  it("oversized spend is denied preflight and normalized", () => {
    const guard = new PolicyGuard({
      transfer: { maxAmountPerCall: "10" },
    });

    const verdict = guard.evaluate("starknet_transfer", {
      recipient: "0xabc",
      token: "STRK",
      amount: "1000",
    });

    expect(verdict.allowed).toBe(false);
    const normalized = normalizeExecutionError(
      "direct",
      `Policy violation: ${verdict.reason ?? "unknown"}`
    );
    expect(normalized.code).toBe("POLICY_BLOCKED");
  });

  it("forbidden selector is denied preflight and normalized", () => {
    const guard = new PolicyGuard({});
    const verdict = guard.evaluate("starknet_invoke_contract", {
      contractAddress: "0xabc",
      entrypoint: "set_owner",
    });

    expect(verdict.allowed).toBe(false);
    const normalized = normalizeExecutionError(
      "starkzap",
      `Policy violation: ${verdict.reason ?? "unknown"}`
    );
    expect(normalized.code).toBe("FORBIDDEN_SELECTOR");
  });

  it("revoked session-key operation is blocked by policy envelope", () => {
    const guard = new PolicyGuard({});
    const verdict = guard.evaluate("starknet_revoke_session_key", {
      accountAddress: "0xabc",
      sessionPublicKey: "0x123",
    });

    expect(verdict.allowed).toBe(false);
    const normalized = normalizeExecutionError(
      "avnu",
      `Policy violation: ${verdict.reason ?? "unknown"}`
    );
    expect(normalized.code).toBe("POLICY_BLOCKED");
  });
});

