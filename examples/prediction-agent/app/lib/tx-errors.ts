/** Map raw starknet.js / wallet errors to user-friendly messages. */
export function friendlyTxError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("user abort") || lower.includes("user reject") || lower.includes("rejected")) {
    return "Transaction rejected in wallet.";
  }
  if (lower.includes("insufficient") || lower.includes("transfer_from") || lower.includes("balance")) {
    return "Insufficient STRK balance for this transaction.";
  }
  if (lower.includes("market not open") || lower.includes("not open")) {
    return "Market is no longer open for trading.";
  }
  if (lower.includes("market not resolved") || lower.includes("not resolved")) {
    return "Market has not been resolved yet.";
  }
  if (lower.includes("resolution time not reached")) {
    return "Resolution time has not been reached yet.";
  }
  if (lower.includes("nonce")) {
    return "Transaction nonce error — please try again.";
  }
  if (lower.includes("timeout") || lower.includes("network") || lower.includes("fetch")) {
    return "Network error — check your connection and try again.";
  }
  if (lower.includes("fee_bps") || lower.includes("fee")) {
    return "Invalid fee configuration.";
  }
  if (lower.includes("not a guild member") || lower.includes("not a member")) {
    return "You must be a guild member to perform this action.";
  }
  if (lower.includes("only oracle")) {
    return "Only the market oracle can perform this action.";
  }
  // Truncate long raw messages
  if (raw.length > 120) return raw.slice(0, 117) + "...";
  return raw;
}
