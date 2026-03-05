#!/usr/bin/env npx tsx
/**
 * E2E Agent Onboarding Flow
 *
 * Canonical path to onboard an agent to Starknet:
 *   1. Preflight — validate env, RPC, chain, deployer balance
 *   2. Deploy   — generate keypair, call factory.deploy_account()
 *   3. Verify   — read new account balances, optional self-transfer
 *   4. Receipt  — emit onboarding_receipt.json
 *
 * Usage:
 *   npx tsx run.ts [--network sepolia] [--token-uri "ipfs://..."] [--verify-tx] [--gasfree]
 *
 * Requires:
 *   - .env file with STARKNET_RPC_URL, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY
 *   - Factory + IdentityRegistry deployed (addresses in config.ts)
 */
export {};
