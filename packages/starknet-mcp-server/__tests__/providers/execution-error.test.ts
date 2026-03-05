import { describe, expect, it } from "vitest";
import { normalizeExecutionError } from "../../src/utils/executionError.js";

describe("normalizeExecutionError parity", () => {
  it("maps unsupported surface consistently across providers", () => {
    const direct = normalizeExecutionError(
      "direct",
      "starknet_swap is not supported with STARKNET_EXECUTION_SURFACE=starkzap"
    );
    const avnu = normalizeExecutionError(
      "avnu",
      "starknet_transfer is not supported with STARKNET_EXECUTION_SURFACE=avnu"
    );
    const starkzap = normalizeExecutionError(
      "starkzap",
      "starknet_transfer is not supported with STARKNET_EXECUTION_SURFACE=starkzap"
    );

    expect(direct.code).toBe("UNSUPPORTED_SURFACE");
    expect(avnu.code).toBe("UNSUPPORTED_SURFACE");
    expect(starkzap.code).toBe("UNSUPPORTED_SURFACE");
  });

  it("maps no-liquidity errors consistently for avnu/starkzap paths", () => {
    const avnu = normalizeExecutionError("avnu", "No quotes available for this swap");
    const starkzap = normalizeExecutionError(
      "starkzap",
      "INSUFFICIENT_LIQUIDITY while building route"
    );
    expect(avnu.code).toBe("NO_LIQUIDITY");
    expect(starkzap.code).toBe("NO_LIQUIDITY");
  });

  it("maps policy selector denials to FORBIDDEN_SELECTOR", () => {
    const direct = normalizeExecutionError(
      "direct",
      'Policy violation: Entrypoint "set_owner" is blocked by default security policy'
    );
    const starkzap = normalizeExecutionError(
      "starkzap",
      'Policy violation: Entrypoint "revoke_session_key" is blocked by policy'
    );
    expect(direct.code).toBe("FORBIDDEN_SELECTOR");
    expect(starkzap.code).toBe("FORBIDDEN_SELECTOR");
  });
});

