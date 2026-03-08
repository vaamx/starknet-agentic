#!/usr/bin/env node
/**
 * hicecaster -- Sovereign prediction agent CLI
 *
 * Deploy forecasters, bet on markets, earn reputation.
 * Chain-agnostic interface. Starknet settlement by default.
 */

import pc from "picocolors";
import { runDeploy } from "./commands/deploy.js";
import { runStatus } from "./commands/status.js";
import { runMarkets } from "./commands/markets.js";
import { runForecast } from "./commands/forecast.js";
import { runWhoami } from "./commands/whoami.js";
import { runBet } from "./commands/bet.js";
import { runTasks } from "./commands/tasks.js";
import { runGuilds } from "./commands/guilds.js";
import { runMint } from "./commands/mint.js";
import { runFund } from "./commands/fund.js";
import { runMarketDetail } from "./commands/market.js";
import { runResolve } from "./commands/resolve.js";
import { runConfig } from "./commands/config.js";
import { loadConfig } from "./config.js";
import type { ChainId } from "./chains.js";

const VERSION = "0.3.0";
const DEFAULT_API =
  process.env.HICECASTER_API_URL ||
  "https://prediction-agent-bdz1v9zzt-cirolabs.vercel.app";
const DEFAULT_CHAIN: ChainId = "starknet";
const DEFAULT_NETWORK = process.env.HICECASTER_NETWORK || "sepolia";

function banner() {
  console.log();
  console.log(
    pc.bold(pc.cyan("  hicecaster")) + pc.dim(` v${VERSION}`)
  );
  console.log(pc.dim("  Sovereign prediction agents"));
  console.log();
}

function help() {
  console.log(`${pc.bold("Usage:")}
  hicecaster <command> [options]

${pc.bold("Commands:")}
  ${pc.cyan("deploy")}              Deploy a sovereign forecaster agent
  ${pc.cyan("status")}              Check agent survival tier and balance
  ${pc.cyan("whoami")}              Show agent identity and reputation
  ${pc.cyan("markets")}             Browse prediction markets
  ${pc.cyan("market")} <id>         Detailed view of a single market
  ${pc.cyan("forecast")} <id>       Research + debate + forecast a market (SSE)
  ${pc.cyan("bet")} <id> <yes|no>   Place a bet on a market
  ${pc.cyan("resolve")} <id>        Trigger resolution oracle
  ${pc.cyan("fund")} <address>      Transfer STRK to an agent
  ${pc.cyan("tasks")}               Browse ProveWork task bounties
  ${pc.cyan("guilds")}              Browse agent guilds
  ${pc.cyan("mint")}                Launch an agent token on a bonding curve
  ${pc.cyan("config")} [show|set]   Manage persistent configuration

${pc.bold("Global Options:")}
  --chain <chain>       Settlement layer (default: starknet)
  --network <net>       Network (default: sepolia)
  --api-url <url>       Hicecaster API URL
  --help, -h            Show help
  --version, -v         Show version

${pc.bold("Deploy Options:")}
  --name <name>         Agent name
  --dry-run             Preview without sending transactions

${pc.bold("Status / Whoami Options:")}
  --address <addr>      Agent address (or set in config/env)

${pc.bold("Markets / Tasks / Guilds Options:")}
  --limit <n>           Number of items to show (default: 20)
  --status <s>          Filter by status
  --sort <s>            Sort order (guilds: members, staked, newest)

${pc.bold("Bet Options:")}
  --amount <n>          STRK amount to bet
  --key <0x...>         Private key (or set in config/env)

${pc.bold("Fund Options:")}
  --amount <n>          STRK amount to send
  --key <0x...>         Sender private key
  --address <addr>      Sender address

${pc.bold("Mint Options:")}
  --name <name>         Token name
  --symbol <sym>        Token symbol
  --curve <type>        Curve type: linear, quadratic, sigmoid (default: linear)
  --fee <bps>           Fee in basis points (default: 250)
  --agent-id <n>        Agent ID to bind token to (default: 0)

${pc.bold("Config Options:")}
  --global, -g          Save to ~/.hicecasterrc instead of local

${pc.bold("Forecast Options:")}
  --verbose             Show individual agent forecasts
  --no-stream           Disable SSE streaming

${pc.bold("Examples:")}
  hicecaster deploy --name oracle-alpha --dry-run
  hicecaster status --address 0x1491...
  hicecaster markets --limit 10
  hicecaster market 1
  hicecaster forecast 1
  hicecaster bet 1 yes --amount 5 --key 0x...
  hicecaster fund 0xAGENT... --amount 10 --key 0x...
  hicecaster resolve 1
  hicecaster tasks
  hicecaster guilds --sort staked
  hicecaster mint --name OracleToken --symbol OTK --curve quadratic
  hicecaster config show
  hicecaster config set address 0x1491...
  hicecaster config set apiUrl http://localhost:3000

${pc.bold("Configuration:")}
  Config files: .hicecasterrc (cwd) > ~/.hicecasterrc (global)
  Env vars: HICECASTER_API_URL, HICECASTER_NETWORK, AGENT_ADDRESS, AGENT_PRIVATE_KEY
  Priority: CLI flags > env vars > config file
`);
}

// -- Arg parsing ------------------------------------------------------------

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((f) => args.includes(f));
}

function resolveAddress(args: string[], cfg: ReturnType<typeof loadConfig>): string {
  const address =
    extractFlag(args, "--address") ||
    process.env.AGENT_ADDRESS ||
    cfg.address;
  if (!address) {
    console.log(pc.red("Missing --address, AGENT_ADDRESS env var, or config."));
    console.log(pc.dim("Set it with: hicecaster config set address 0x..."));
    process.exit(1);
  }
  return address;
}

function resolveKey(args: string[], cfg: ReturnType<typeof loadConfig>): { address: string; privateKey: string } {
  const address = resolveAddress(args, cfg);
  const privateKey =
    extractFlag(args, "--key") ||
    process.env.AGENT_PRIVATE_KEY ||
    cfg.privateKey;
  if (!privateKey) {
    console.log(pc.red("Missing --key, AGENT_PRIVATE_KEY env var, or config."));
    console.log(pc.dim("Set it with: hicecaster config set privateKey 0x..."));
    process.exit(1);
  }
  return { address, privateKey };
}

// -- Main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || hasFlag(args, "--help", "-h")) {
    banner();
    help();
    process.exit(0);
  }

  if (hasFlag(args, "--version", "-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  // Load config file
  const cfg = loadConfig();

  // Global options (CLI > env > config)
  const chain = (extractFlag(args, "--chain") || cfg.chain || DEFAULT_CHAIN) as ChainId;
  const network = extractFlag(args, "--network") || process.env.HICECASTER_NETWORK || cfg.network || DEFAULT_NETWORK;
  const apiUrl = extractFlag(args, "--api-url") || process.env.HICECASTER_API_URL || cfg.apiUrl || DEFAULT_API;

  banner();

  switch (command) {
    case "deploy": {
      await runDeploy({
        name: extractFlag(args, "--name"),
        network,
        chain,
        dryRun: hasFlag(args, "--dry-run"),
      });
      break;
    }

    case "status": {
      await runStatus({ address: resolveAddress(args, cfg), network, chain });
      break;
    }

    case "whoami": {
      await runWhoami({ address: resolveAddress(args, cfg), network, chain });
      break;
    }

    case "markets": {
      await runMarkets({
        apiUrl,
        limit: parseInt(extractFlag(args, "--limit") || "20", 10),
        status: extractFlag(args, "--status"),
      });
      break;
    }

    case "market": {
      const marketId = args[1];
      if (!marketId || marketId.startsWith("-")) {
        console.log(pc.red("Usage: hicecaster market <market-id>"));
        process.exit(1);
      }
      await runMarketDetail({ marketId, apiUrl });
      break;
    }

    case "forecast": {
      const marketId = args[1];
      if (!marketId || marketId.startsWith("-")) {
        console.log(pc.red("Usage: hicecaster forecast <market-id>"));
        process.exit(1);
      }
      await runForecast({
        marketId,
        apiUrl,
        verbose: hasFlag(args, "--verbose"),
      });
      break;
    }

    case "bet": {
      const marketId = args[1];
      const side = args[2] as "yes" | "no";
      if (!marketId || !side || !["yes", "no"].includes(side)) {
        console.log(pc.red("Usage: hicecaster bet <market-id> <yes|no> --amount <n>"));
        process.exit(1);
      }
      const amount = parseFloat(extractFlag(args, "--amount") || "0");
      if (amount <= 0) {
        console.log(pc.red("--amount must be > 0"));
        process.exit(1);
      }
      const { address, privateKey } = resolveKey(args, cfg);
      await runBet({ marketId, side, amount, privateKey, address, network, chain, apiUrl });
      break;
    }

    case "resolve": {
      const marketId = args[1];
      if (!marketId || marketId.startsWith("-")) {
        console.log(pc.red("Usage: hicecaster resolve <market-id>"));
        process.exit(1);
      }
      await runResolve({ marketId, apiUrl });
      break;
    }

    case "fund": {
      const to = args[1];
      if (!to || !to.startsWith("0x")) {
        console.log(pc.red("Usage: hicecaster fund <recipient-address> --amount <n>"));
        process.exit(1);
      }
      const amount = parseFloat(extractFlag(args, "--amount") || "0");
      if (amount <= 0) {
        console.log(pc.red("--amount must be > 0"));
        process.exit(1);
      }
      const { address, privateKey } = resolveKey(args, cfg);
      await runFund({ to, amount, privateKey, address, network, chain });
      break;
    }

    case "tasks": {
      await runTasks({
        apiUrl,
        limit: parseInt(extractFlag(args, "--limit") || "20", 10),
        status: extractFlag(args, "--status"),
      });
      break;
    }

    case "guilds": {
      await runGuilds({
        apiUrl,
        limit: parseInt(extractFlag(args, "--limit") || "20", 10),
        sort: extractFlag(args, "--sort") || "members",
      });
      break;
    }

    case "mint": {
      const name = extractFlag(args, "--name");
      const symbol = extractFlag(args, "--symbol");
      if (!name || !symbol) {
        console.log(pc.red("Usage: hicecaster mint --name <name> --symbol <sym>"));
        process.exit(1);
      }
      const curve = (extractFlag(args, "--curve") || "linear") as "linear" | "quadratic" | "sigmoid";
      const feeBps = parseInt(extractFlag(args, "--fee") || "250", 10);
      const agentId = parseInt(extractFlag(args, "--agent-id") || "0", 10);
      const { address, privateKey } = resolveKey(args, cfg);
      await runMint({ name, symbol, curve, feeBps, agentId, privateKey, address, network, chain });
      break;
    }

    case "config": {
      const action = args[1] === "set" ? "set" : "show";
      runConfig({
        action,
        key: args[2],
        value: args[3],
        global: hasFlag(args, "--global", "-g"),
      });
      break;
    }

    default:
      console.log(pc.red(`Unknown command: ${command}`));
      console.log(pc.dim("Run hicecaster --help for usage"));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(pc.red("Error:"), err.message);
  process.exit(1);
});
