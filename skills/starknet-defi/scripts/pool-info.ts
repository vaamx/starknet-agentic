#!/usr/bin/env tsx
/**
 * Pool / Liquidity Info via avnu
 *
 * Usage: npx tsx scripts/pool-info.ts ETH/STRK
 * Shows best routes and liquidity for a token pair.
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
  const pairArg = process.argv[2] || 'ETH/STRK';
  const [sellSymbol, buySymbol] = pairArg.split('/');
  if (!sellSymbol || !buySymbol) {
    console.error('Usage: npx tsx scripts/pool-info.ts TOKEN_A/TOKEN_B');
    process.exit(1);
  }

  const sell = await resolveToken(sellSymbol);
  const buy = await resolveToken(buySymbol);

  // Probe multiple amounts to show route depth.
  const amountInputs = ['0.01', '0.1', '1', '10'];

  console.log(`\nPool info: ${sell.symbol}/${buy.symbol}`);
  console.log('(quote samples across increasing size)\n');

  for (const amountInput of amountInputs) {
    const sellAmount = parseDecimalToBigInt(amountInput, sell.decimals);
    const label = `${amountInput} ${sell.symbol}`;
    try {
      const quotes = await getQuotes({
        sellTokenAddress: sell.address,
        buyTokenAddress: buy.address,
        sellAmount,
      });
      if (!quotes.length) {
        console.log(`  ${label}: No liquidity`);
        continue;
      }
      const best = quotes[0]!;
      const buyAmount = formatAmount(BigInt(best.buyAmount), buy.decimals, 8);
      const routes = formatRoutes(best.routes as Array<{ name: string; percent: number }> | undefined);
      const priceImpact = best.priceImpact != null ? `${(best.priceImpact / 100).toFixed(2)}%` : 'N/A';
      console.log(
        `  ${label.padEnd(12)} -> ${buyAmount.padStart(14)} ${buy.symbol} | impact ${priceImpact.padStart(7)} | routes ${routes}`
      );
    } catch (error) {
      console.log(`  ${label}: ${formatError(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
