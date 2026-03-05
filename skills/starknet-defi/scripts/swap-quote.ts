#!/usr/bin/env tsx
/**
 * Get Swap Quote via avnu
 *
 * Usage: npx tsx scripts/swap-quote.ts ETH USDC 0.1
 * Optional taker address from .env: AGENT_ADDRESS or STARKNET_ACCOUNT_ADDRESS
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
  const [sellSymbol, buySymbol, amountStr] = process.argv.slice(2);
  if (!sellSymbol || !buySymbol || !amountStr) {
    console.error('Usage: npx tsx scripts/swap-quote.ts <SELL_TOKEN> <BUY_TOKEN> <AMOUNT>');
    console.error('Example: npx tsx scripts/swap-quote.ts ETH USDC 0.1');
    process.exit(1);
  }

  const sell = await resolveToken(sellSymbol);
  const buy = await resolveToken(buySymbol);
  const sellAmount = parseDecimalToBigInt(amountStr, sell.decimals);
  if (sellAmount <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }

  const takerAddress = process.env.AGENT_ADDRESS || process.env.STARKNET_ACCOUNT_ADDRESS;

  console.log(`\nFetching quote: ${amountStr} ${sell.symbol} -> ${buy.symbol}...`);

  const quotes = await getQuotes({
    sellTokenAddress: sell.address,
    buyTokenAddress: buy.address,
    sellAmount,
    takerAddress,
  });

  if (!quotes.length) {
    console.error('No quotes available.');
    process.exit(1);
  }

  const best = quotes[0]!;
  const buyAmountRaw = BigInt(best.buyAmount);
  const buyAmount = formatAmount(buyAmountRaw, buy.decimals, 8);
  const rateScaled = (buyAmountRaw * 10n ** BigInt(sell.decimals)) / sellAmount;
  const rate = formatAmount(rateScaled, buy.decimals, 8);

  console.log(`\n  Sell:         ${amountStr} ${sell.symbol}`);
  console.log(`  Receive:      ${buyAmount} ${buy.symbol}`);
  console.log(`  Rate:         1 ${sell.symbol} = ${rate} ${buy.symbol}`);
  console.log(`  Sell (USD):   $${best.sellAmountInUsd?.toFixed(2) || 'N/A'}`);
  console.log(`  Buy (USD):    $${best.buyAmountInUsd?.toFixed(2) || 'N/A'}`);
  console.log(`  Price Impact: ${best.priceImpact != null ? (best.priceImpact / 100).toFixed(2) + '%' : 'N/A'}`);
  console.log(`  Gas (USD):    $${best.gasFeesInUsd?.toFixed(4) || 'N/A'}`);
  console.log(`  Routes:       ${formatRoutes(best.routes as Array<{ name: string; percent: number }> | undefined)}`);
  console.log(`  Quote ID:     ${best.quoteId}`);
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
