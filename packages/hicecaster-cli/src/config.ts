/**
 * Config file loader — reads from .hicecasterrc (JSON) in cwd or home dir.
 *
 * Precedence: CLI flags > env vars > .hicecasterrc (cwd) > .hicecasterrc (home)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface HicecasterConfig {
  apiUrl?: string;
  address?: string;
  privateKey?: string;
  network?: string;
  chain?: string;
}

function tryReadJson(filePath: string): HicecasterConfig | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as HicecasterConfig;
  } catch {
    return null;
  }
}

export function loadConfig(): HicecasterConfig {
  // cwd first, then home
  const cwdConfig = tryReadJson(path.join(process.cwd(), ".hicecasterrc"));
  const homeConfig = tryReadJson(path.join(os.homedir(), ".hicecasterrc"));

  return { ...homeConfig, ...cwdConfig };
}

export function writeConfig(config: HicecasterConfig, global = false): void {
  const dir = global ? os.homedir() : process.cwd();
  const filePath = path.join(dir, ".hicecasterrc");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}
