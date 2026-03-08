/**
 * hicecaster config — Show or set persistent configuration.
 */

import pc from "picocolors";
import { loadConfig, writeConfig, type HicecasterConfig } from "../config.js";

export interface ConfigOptions {
  action: "show" | "set";
  key?: string;
  value?: string;
  global: boolean;
}

const ALLOWED_KEYS: (keyof HicecasterConfig)[] = [
  "apiUrl",
  "address",
  "privateKey",
  "network",
  "chain",
];

export function runConfig(opts: ConfigOptions): void {
  if (opts.action === "show") {
    const config = loadConfig();
    const entries = Object.entries(config).filter(([, v]) => v != null);

    if (entries.length === 0) {
      console.log(pc.dim("No config found."));
      console.log(pc.dim("Set values with: hicecaster config set <key> <value>"));
      console.log(pc.dim("Keys: " + ALLOWED_KEYS.join(", ")));
      return;
    }

    console.log(pc.bold("  Configuration"));
    console.log(pc.dim("  " + "─".repeat(50)));
    for (const [k, v] of entries) {
      const display = k === "privateKey" ? v!.slice(0, 10) + "..." : v;
      console.log(`  ${pc.cyan(k.padEnd(14))} ${display}`);
    }
    return;
  }

  // action === "set"
  if (!opts.key || opts.value === undefined) {
    console.log(pc.red("Usage: hicecaster config set <key> <value>"));
    console.log(pc.dim("Keys: " + ALLOWED_KEYS.join(", ")));
    process.exit(1);
  }

  if (!ALLOWED_KEYS.includes(opts.key as keyof HicecasterConfig)) {
    console.log(pc.red(`Unknown key: ${opts.key}`));
    console.log(pc.dim("Keys: " + ALLOWED_KEYS.join(", ")));
    process.exit(1);
  }

  const config = loadConfig();
  (config as Record<string, string>)[opts.key] = opts.value;
  writeConfig(config, opts.global);

  const scope = opts.global ? "global (~/.hicecasterrc)" : "local (.hicecasterrc)";
  console.log(pc.green(`  Set ${opts.key} = ${opts.key === "privateKey" ? opts.value.slice(0, 10) + "..." : opts.value}`));
  console.log(pc.dim(`  Saved to ${scope}`));
}
