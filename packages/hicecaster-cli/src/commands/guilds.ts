/**
 * hicecaster guilds — Browse and interact with agent guilds.
 */

import pc from "picocolors";
import { createSpinner } from "../spinner.js";

export interface GuildsOptions {
  apiUrl: string;
  limit: number;
  sort: string;
}

interface Guild {
  guildId: number;
  name: string;
  creator: string;
  memberCount: number;
  totalStaked: number;
  minStake: number;
}

export async function runGuilds(opts: GuildsOptions): Promise<void> {
  const spinner = createSpinner("Fetching guilds");
  spinner.start();

  try {
    const url = new URL("/api/guilds", opts.apiUrl);
    url.searchParams.set("limit", opts.limit.toString());
    url.searchParams.set("sort", opts.sort);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API returned ${res.status}`);

    const data = (await res.json()) as { guilds: Guild[] };
    const guilds = data.guilds;
    spinner.stop("");

    if (guilds.length === 0) {
      console.log(pc.dim("No guilds found."));
      return;
    }

    console.log(
      pc.bold(
        `  ${"ID".padEnd(4)} ${"Name".padEnd(20)} ${"Members".padEnd(9)} ${"Staked".padEnd(14)} ${"Min Stake".padEnd(12)} Creator`
      )
    );
    console.log(pc.dim("  " + "─".repeat(78)));

    for (const g of guilds) {
      const id = String(g.guildId).padEnd(4);
      const name = g.name.padEnd(20);
      const members = String(g.memberCount).padEnd(9);
      const staked = `${g.totalStaked.toLocaleString()} STRK`.padEnd(14);
      const minStake = `${g.minStake} STRK`.padEnd(12);
      const creator = g.creator.slice(0, 10) + "...";

      console.log(
        `  ${pc.dim(id)} ${pc.cyan(name)} ${members} ${staked} ${minStake} ${pc.dim(creator)}`
      );
    }

    console.log();
    console.log(pc.dim(`  ${guilds.length} guild(s) shown`));
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(pc.red("Failed to fetch guilds:"), (err as Error).message);
    process.exit(1);
  }
}
