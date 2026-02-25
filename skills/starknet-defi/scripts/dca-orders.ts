#!/usr/bin/env tsx
/**
 * List AVNU DCA orders for an address.
 *
 * Usage:
 *   npx tsx scripts/dca-orders.ts
 *   npx tsx scripts/dca-orders.ts 0xYOUR_ADDRESS active
 *
 * Status values: active | closed | indexing | all
 * If address is omitted, script uses AGENT_ADDRESS or STARKNET_ACCOUNT_ADDRESS.
 */

import 'dotenv/config';
import { DcaOrderStatus, getDcaOrders } from '@avnu/avnu-sdk';
import {
  formatAmount,
  formatError,
  resolveToken,
  shortAddress,
} from './_shared.js';

function parseStatus(input?: string): DcaOrderStatus | undefined {
  const enumMap = DcaOrderStatus as unknown as Record<string, DcaOrderStatus>;
  const activeStatus = enumMap.ACTIVE ?? enumMap.OPEN;
  const value = input?.toLowerCase() ?? 'open';
  switch (value) {
    case 'open':
    case 'active':
      if (!activeStatus) {
        throw new Error('DCA active status is not exposed by this SDK build.');
      }
      return activeStatus;
    case 'closed':
      return enumMap.CLOSED;
    case 'indexing':
      return enumMap.INDEXING;
    case 'all':
      return undefined;
    default:
      throw new Error('Invalid status. Use one of: active, closed, indexing, all');
  }
}

async function tokenLabel(tokenValue: unknown): Promise<{ symbol: string; decimals: number }> {
  if (typeof tokenValue !== 'string' || tokenValue.length === 0) {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
  try {
    const token = await resolveToken(tokenValue);
    return { symbol: token.symbol, decimals: token.decimals };
  } catch {
    return { symbol: shortAddress(tokenValue), decimals: 18 };
  }
}

async function main() {
  const address = process.argv[2] || process.env.AGENT_ADDRESS || process.env.STARKNET_ACCOUNT_ADDRESS;
  if (!address) {
    throw new Error('Missing address. Pass one as arg or set AGENT_ADDRESS / STARKNET_ACCOUNT_ADDRESS.');
  }

  const status = parseStatus(process.argv[3]);
  const statusLabel = process.argv[3]?.toLowerCase() || 'open';
  console.log(`\nFetching DCA orders for ${shortAddress(address)} (status: ${statusLabel})...`);

  const page = await getDcaOrders({
    traderAddress: address,
    status,
  });
  const orders = page.content;

  if (orders.length === 0) {
    console.log('No matching DCA orders.');
    return;
  }

  console.log(`Found ${orders.length} order(s) on page ${page.number + 1}/${page.totalPages}:\n`);

  for (const order of orders) {
    const orderAddress = order.orderAddress;
    const sellInfo = await tokenLabel(order.sellTokenAddress);
    const buyInfo = await tokenLabel(order.buyTokenAddress);
    const start = order.startDate instanceof Date ? order.startDate.toISOString() : String(order.startDate);
    const end = order.endDate instanceof Date ? order.endDate.toISOString() : String(order.endDate);
    const close = order.closeDate instanceof Date ? order.closeDate.toISOString() : 'N/A';

    console.log(`- ${shortAddress(orderAddress, 8)} | ${sellInfo.symbol} -> ${buyInfo.symbol} | status ${order.status}`);
    console.log(`  sell total: ${formatAmount(order.sellAmount, sellInfo.decimals, 6)} ${sellInfo.symbol}`);
    console.log(`  per cycle:  ${formatAmount(order.sellAmountPerCycle, sellInfo.decimals, 6)} ${sellInfo.symbol}`);
    console.log(`  sold/bought:${formatAmount(order.amountSold, sellInfo.decimals, 6)} ${sellInfo.symbol} / ${formatAmount(order.amountBought, buyInfo.decimals, 6)} ${buyInfo.symbol}`);
    console.log(`  trades: executed=${order.executedTradesCount}, pending=${order.pendingTradesCount}, cancelled=${order.cancelledTradesCount}`);
    console.log(`  window: ${start} -> ${end} (closed: ${close})`);
  }
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
