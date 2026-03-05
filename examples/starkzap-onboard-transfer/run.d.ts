#!/usr/bin/env npx tsx
/**
 * Starkzap Demo: Gasless Onboarding + STRK Transfer on Sepolia
 *
 * Flow:
 *   1. SDK init on Sepolia (with optional AVNU paymaster for sponsored)
 *   2. Connect wallet via Signer strategy (or Privy in full demo)
 *   3. wallet.ensureReady({ deploy: "if_needed" }) — sponsored deploy when paymaster configured
 *   4. wallet.transfer(STRK, [...]) — transfer (gasless with --sponsored)
 *   5. tx.wait() — stream finality confirmation
 *
 * Usage:
 *   npx tsx run.ts [--recipient 0x...] [--amount 10] [--sponsored]
 *
 * Env:
 *   PRIVATE_KEY          — test signer (generate with: PRIVATE_KEY=0x$(openssl rand -hex 32))
 *   AVNU_PAYMASTER_API_KEY — for --sponsored mode (get from portal.avnu.fi)
 *   STARKNET_RPC_URL     — optional, defaults to public Sepolia RPC
 */
export {};
