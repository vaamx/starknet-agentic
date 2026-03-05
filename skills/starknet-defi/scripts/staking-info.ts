#!/usr/bin/env tsx
/**
 * Inspect AVNU STRK staking pools and (optionally) user position.
 *
 * Usage:
 *   npx tsx scripts/staking-info.ts
 *   npx tsx scripts/staking-info.ts 0xYOUR_ADDRESS
 *
 * If no address is passed, the script tries:
 *   AGENT_ADDRESS -> STARKNET_ACCOUNT_ADDRESS
 */

import 'dotenv/config';
import {
  getAvnuStakingInfo,
  getUserStakingInfo,
  type StakingInfo,
  type UserStakingInfo,
} from '@avnu/avnu-sdk';
import { formatAmount, formatError, shortAddress } from './_shared.js';

const STRK_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

async function main() {
  const address = process.argv[2] || process.env.AGENT_ADDRESS || process.env.STARKNET_ACCOUNT_ADDRESS;

  console.log('\nFetching AVNU staking pools...');
  const stakingInfo: StakingInfo = await getAvnuStakingInfo();
  const pools = stakingInfo.delegationPools;

  console.log(`Operator: ${shortAddress(stakingInfo.operationalAddress)}`);
  console.log(`Staker:   ${shortAddress(stakingInfo.stakerAddress)}`);
  console.log(`Reward:   ${shortAddress(stakingInfo.rewardAddress)}`);
  console.log(`Self stake: ${formatAmount(stakingInfo.selfStakedAmount, 18, 6)} STRK`);

  if (!pools || pools.length === 0) {
    console.log('No staking pools returned.');
  } else {
    console.log(`Found ${pools.length} pool(s):\n`);
    pools.forEach((pool, i) => {
      const apr = Number.isFinite(pool.apr) ? `${pool.apr.toFixed(2)}%` : 'N/A';
      console.log(
        `${String(i + 1).padStart(2, '0')}. token ${shortAddress(pool.tokenAddress)} | ` +
        `pool ${shortAddress(pool.poolAddress)} | APR ${apr} | staked ${formatAmount(pool.stakedAmount, 18, 6)}`
      );
    });
  }

  if (!address) {
    console.log('\nTip: pass a wallet address (or set AGENT_ADDRESS) to inspect user staking position.');
    return;
  }

  console.log(`\nFetching staking position for ${shortAddress(address)}...`);
  const userInfo: UserStakingInfo = await getUserStakingInfo(STRK_ADDRESS, address);
  const latestApr = userInfo.aprs.length > 0 ? `${userInfo.aprs[userInfo.aprs.length - 1]!.apr.toFixed(2)}%` : 'N/A';
  const unpoolTime = userInfo.unpoolTime ? userInfo.unpoolTime.toISOString() : 'N/A';

  console.log(`  Pool:              ${shortAddress(userInfo.poolAddress)}`);
  console.log(`  Staked:            ${formatAmount(userInfo.amount, 18, 6)} STRK`);
  console.log(`  Unclaimed rewards: ${formatAmount(userInfo.unclaimedRewards, 18, 6)} STRK`);
  console.log(`  Pending unpool:    ${formatAmount(userInfo.unpoolAmount, 18, 6)} STRK`);
  console.log(`  Unpool time:       ${unpoolTime}`);
  console.log(`  Expected yearly:   ${formatAmount(userInfo.expectedYearlyStrkRewards, 18, 6)} STRK`);
  console.log(`  Latest APR:        ${latestApr}`);
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
