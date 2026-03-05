import type { ExecutionSurface, TxErrorCode } from "./starknet-executor";

export interface NormalizedExecutionError {
  code: TxErrorCode;
  message: string;
  executionSurface: ExecutionSurface;
}

export function normalizeExecutionError(
  executionSurface: ExecutionSurface,
  rawError: unknown
): NormalizedExecutionError {
  const message =
    typeof rawError === "string"
      ? rawError
      : (rawError as any)?.message ?? "Execution failed";

  const lower = message.toLowerCase();
  if (
    lower.includes("policy violation") ||
    lower.includes("oversized spend") ||
    lower.includes("overspend") ||
    lower.includes("max amount")
  ) {
    return {
      code: "POLICY_BLOCKED",
      message,
      executionSurface,
    };
  }

  if (
    lower.includes("forbidden selector") ||
    lower.includes("forbidden entrypoint") ||
    lower.includes("entrypoint blocked")
  ) {
    return {
      code: "FORBIDDEN_SELECTOR",
      message,
      executionSurface,
    };
  }

  if (
    lower.includes("session key revoked") ||
    lower.includes("revoked key") ||
    (lower.includes("session key") && lower.includes("revoked"))
  ) {
    return {
      code: "SESSION_KEY_REVOKED",
      message,
      executionSurface,
    };
  }

  if (
    lower.includes("unavailable") ||
    lower.includes("cannot find module") ||
    lower.includes("install it") ||
    lower.includes("incomplete starkzap")
  ) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      message,
      executionSurface,
    };
  }

  if (lower.includes("blocked when execution_profile")) {
    return {
      code: "UNSUPPORTED_SURFACE",
      message,
      executionSurface,
    };
  }

  return {
    code: "EXECUTION_FAILED",
    message,
    executionSurface,
  };
}
