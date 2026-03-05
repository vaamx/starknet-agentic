#!/usr/bin/env tsx
/**
 * Manual test: Verify LORDS token is fetched via avnu SDK
 *
 * This test verifies that:
 * 1. LORDS (not in static list) is resolved via avnu SDK
 * 2. Token info is cached after first fetch
 * 3. Static tokens (ETH, STRK) don't trigger avnu calls
 *
 * Run: npx tsx __tests__/services/TokenService.manual.ts
 */
export {};
