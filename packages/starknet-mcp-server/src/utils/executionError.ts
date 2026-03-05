export type ExecutionSurface = "direct" | "avnu" | "starkzap";

export type StandardErrorCode =
  | "POLICY_BLOCKED"
  | "UNSUPPORTED_SURFACE"
  | "NO_LIQUIDITY"
  | "SLIPPAGE_EXCEEDED"
  | "SESSION_REVOKED"
  | "FORBIDDEN_SELECTOR"
  | "INSUFFICIENT_FUNDS"
  | "PROVIDER_UNAVAILABLE"
  | "EXECUTION_FAILED";

export function normalizeExecutionError(
  executionSurface: ExecutionSurface,
  rawMessage: string
): { code: StandardErrorCode; surface: ExecutionSurface } {
  const msg = rawMessage.toLowerCase();

  if (msg.includes("policy violation")) {
    if (msg.includes("entrypoint")) {
      return { code: "FORBIDDEN_SELECTOR", surface: executionSurface };
    }
    return { code: "POLICY_BLOCKED", surface: executionSurface };
  }

  if (msg.includes("not supported with starknet_execution_surface")) {
    return { code: "UNSUPPORTED_SURFACE", surface: executionSurface };
  }

  if (msg.includes("requires starknet_signer_mode=direct")) {
    return { code: "UNSUPPORTED_SURFACE", surface: executionSurface };
  }

  if (msg.includes("no quotes available") || msg.includes("insufficient_liquidity")) {
    return { code: "NO_LIQUIDITY", surface: executionSurface };
  }

  if (msg.includes("slippage")) {
    return { code: "SLIPPAGE_EXCEEDED", surface: executionSurface };
  }

  if (msg.includes("revoke_session_key") || msg.includes("session key revoked")) {
    return { code: "SESSION_REVOKED", surface: executionSurface };
  }

  if (msg.includes("blocked by default security policy") || msg.includes("blocked entrypoint")) {
    return { code: "FORBIDDEN_SELECTOR", surface: executionSurface };
  }

  if (msg.includes("insufficient") && msg.includes("fund")) {
    return { code: "INSUFFICIENT_FUNDS", surface: executionSurface };
  }

  if (msg.includes("starkzap sdk is unavailable") || msg.includes("cannot find module")) {
    return { code: "PROVIDER_UNAVAILABLE", surface: executionSurface };
  }

  return { code: "EXECUTION_FAILED", surface: executionSurface };
}
