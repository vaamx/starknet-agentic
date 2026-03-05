import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const anonymousSkillPath = path.join(
  repoRoot,
  "skills/starknet-anonymous-wallet/SKILL.md"
);
const anonymousScriptsDir = path.join(
  repoRoot,
  "skills/starknet-anonymous-wallet/scripts"
);

describe("Standalone skill script workflow coverage (V1-1.8.4)", () => {
  it("documents standalone rationale and Typhoon context", () => {
    const skill = readFileSync(anonymousSkillPath, "utf8");
    expect(skill).toMatch(/## Standalone Execution \(No MCP Tool Yet\)/i);
    expect(skill).toMatch(/Typhoon/i);
    expect(skill).not.toMatch(/## MCP Tools Used/i);
  });

  it("keeps required script workflow entrypoints for anonymous wallet flows", () => {
    const requiredScripts = [
      "check-account.js",
      "create-account.js",
      "show-address.js",
      "load-account.js",
      "call-contract.js",
      "invoke-contract.js",
      "simulate.js",
      "estimate-fee.js",
    ];

    for (const script of requiredScripts) {
      const scriptPath = path.join(anonymousScriptsDir, script);
      expect(
        existsSync(scriptPath),
        `missing script required for standalone workflow: ${script}`
      ).toBe(true);
    }
  });
});

