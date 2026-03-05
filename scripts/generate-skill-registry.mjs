#!/usr/bin/env node
/**
 * Generate skills/registry.json from all SKILL.md files.
 *
 * Run: node scripts/generate-skill-registry.mjs > skills/registry.json
 *
 * Used in CI to produce a machine-readable skill manifest served at a
 * predictable raw GitHub URL — no API auth, no rate-limiting.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const BASE_RAW_URL =
  "https://raw.githubusercontent.com/keep-starknet-strange/starknet-agentic/main";

const skills = [];

let skillDirs;
try {
  skillDirs = readdirSync("skills/", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} catch {
  process.stderr.write("Error: run this script from the repo root.\n");
  process.exit(1);
}

for (const name of skillDirs) {
  const mdPath = join("skills", name, "SKILL.md");
  if (!existsSync(mdPath)) continue;

  let content;
  try {
    content = readFileSync(mdPath, "utf-8");
  } catch {
    process.stderr.write(`Warning: could not read ${mdPath}\n`);
    continue;
  }

  // Extract YAML frontmatter between the first pair of --- delimiters.
  // Handle both LF and CRLF line endings; do NOT use a dynamic key in RegExp
  // (avoids regex injection if a skill name contains metacharacters).
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) {
    process.stderr.write(`Warning: no frontmatter in ${mdPath}\n`);
    continue;
  }

  const front = match[1];

  /**
   * Extract a single-line YAML scalar for a given key.
   * The key is escaped before being used in a RegExp to handle any
   * metacharacters in key names (e.g. "user-invocable" contains a hyphen).
   */
  const get = (key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = front.match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : "";
  };

  // Parse YAML array literal: [val1, val2, 'val3', "val4"]
  const parseYamlArray = (raw) => {
    if (!raw) return [];
    const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((k) => k.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  };

  const keywordsRaw = front.match(/^keywords:\s*(\[.+\])$/m)?.[1] ?? "";
  const keywords = parseYamlArray(keywordsRaw);

  const skillName = get("name");
  if (!skillName) {
    process.stderr.write(`Warning: missing 'name' in ${mdPath}\n`);
    continue;
  }

  skills.push({
    name: skillName,
    description: get("description"),
    keywords,
    url: `${BASE_RAW_URL}/skills/${name}/SKILL.md`,
    hasScripts: existsSync(join("skills", name, "scripts")),
    hasReferences: existsSync(join("skills", name, "references")),
    // YAML booleans may appear as quoted "true" or unquoted true (stripped of quotes by get()).
    userInvocable: get("user-invocable").toLowerCase() === "true",
  });
}

process.stdout.write(JSON.stringify({ version: "1", skills }, null, 2) + "\n");
