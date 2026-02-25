#!/usr/bin/env tsx
/**
 * Check Token Price via avnu
 *
 * Usage: npx tsx scripts/check-price.ts ETH USDC [AMOUNT]
 * Example: npx tsx scripts/check-price.ts ETH USDC 1
 */

import 'dotenv/config';
import { getQuotes } from '@avnu/avnu-sdk';
import {
  formatAmount,
  formatError,
  formatRoutes,
  parseDecimalToBigInt,
  resolveToken,
} from './_shared.js';

async function main() {
  const [sellSymbol = 'ETH', buySymbol = 'USDC', amountInput = '1'] = process.argv.slice(2);

  const sell = await resolveToken(sellSymbol);
  const buy = await resolveToken(buySymbol);
  const sellAmount = parseDecimalToBigInt(amountInput, sell.decimals);
  if (sellAmount <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }
  console.log(`\nFetching price: ${amountInput} ${sell.symbol} -> ${buy.symbol}...`);

  const quotes = await getQuotes({
    sellTokenAddress: sell.address,
    buyTokenAddress: buy.address,
    sellAmount,
  });

  if (!quotes.length) {
    console.error('No quotes available for this pair.');
    process.exit(1);
  }

  const best = quotes[0]!;
  const buyAmount = formatAmount(BigInt(best.buyAmount), buy.decimals, 8);

  console.log(`\n  Sell:       ${amountInput} ${sell.symbol}`);
  console.log(`  Receive:    ${buyAmount} ${buy.symbol}`);
  console.log(`  Routes:     ${formatRoutes(best.routes as Array<{ name: string; percent: number }> | undefined)}`);
  console.log(`  PriceImpact:${best.priceImpact != null ? ` ${(best.priceImpact / 100).toFixed(2)}%` : ' N/A'}`);
  console.log(`  Gas (USD):  ${best.gasFeesInUsd != null ? `$${best.gasFeesInUsd.toFixed(4)}` : 'N/A'}`);
  console.log(`  Quote ID:   ${best.quoteId}`);
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
