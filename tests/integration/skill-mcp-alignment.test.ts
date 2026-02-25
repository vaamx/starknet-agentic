import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const mcpServerPath = path.join(
  repoRoot,
  "packages/starknet-mcp-server/src/index.ts"
);

type SkillExpectation = {
  skillPath: string;
  mode: "mcp" | "standalone";
};

const V1_SKILL_EXPECTATIONS: SkillExpectation[] = [
  { skillPath: "skills/starknet-wallet/SKILL.md", mode: "mcp" },
  { skillPath: "skills/starknet-defi/SKILL.md", mode: "mcp" },
  { skillPath: "skills/starknet-identity/SKILL.md", mode: "mcp" },
  { skillPath: "skills/starknet-mini-pay/SKILL.md", mode: "mcp" },
  { skillPath: "skills/starknet-anonymous-wallet/SKILL.md", mode: "standalone" },
  { skillPath: "skills/huginn-onboard/SKILL.md", mode: "standalone" },
];

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractSection(content: string, heading: string): string | null {
  const headingToken = `## ${heading}`;
  const start = content.indexOf(headingToken);
  if (start === -1) return null;

  const afterStart = content.slice(start + headingToken.length);
  const nextHeadingOffset = afterStart.search(/\n## |\n# /);
  if (nextHeadingOffset === -1) {
    return content.slice(start);
  }
  return content.slice(start, start + headingToken.length + nextHeadingOffset);
}

function extractToolNamesFromText(content: string): string[] {
  const tools = new Set<string>();
  for (const match of content.matchAll(/`((?:starknet|prediction|x402)_[a-z0-9_]+)`/g)) {
    tools.add(match[1]!);
  }
  return [...tools];
}

function parseDeclaredTools(mcpSource: string): Set<string> {
  const names = new Set<string>();
  for (const match of mcpSource.matchAll(/\bname:\s*"([a-z][a-z0-9_]+)"/g)) {
    const name = match[1]!;
    if (
      name.startsWith("starknet_") ||
      name.startsWith("prediction_") ||
      name.startsWith("x402_")
    ) {
      names.add(name);
    }
  }
  return names;
}

function parseToolHandlers(mcpSource: string): Set<string> {
  const names = new Set<string>();
  for (const match of mcpSource.matchAll(/\bcase\s+"([a-z][a-z0-9_]+)"/g)) {
    names.add(match[1]!);
  }
  return names;
}

describe("Cross-skill MCP alignment (V1-5b)", () => {
  const mcpSource = readRepoFile(path.relative(repoRoot, mcpServerPath));
  const declaredToolNames = parseDeclaredTools(mcpSource);
  const handlerNames = parseToolHandlers(mcpSource);

  it("MCP-mode skills expose a canonical 'MCP Tools Used' section", () => {
    for (const expectation of V1_SKILL_EXPECTATIONS) {
      const content = readRepoFile(expectation.skillPath);

      if (expectation.mode === "mcp") {
        expect(
          extractSection(content, "MCP Tools Used"),
          `${expectation.skillPath} must document MCP tools`
        ).not.toBeNull();
      }

      if (expectation.mode === "standalone") {
        expect(
          extractSection(content, "Standalone Execution"),
          `${expectation.skillPath} must explicitly explain standalone execution rationale`
        ).not.toBeNull();
      }
    }
  });

  it("every MCP tool referenced in v1 skill sections is declared and handled by MCP server", () => {
    const mcpReferencedTools = new Set<string>();

    for (const expectation of V1_SKILL_EXPECTATIONS) {
      if (expectation.mode !== "mcp") continue;
      const content = readRepoFile(expectation.skillPath);
      const mcpSection = extractSection(content, "MCP Tools Used");
      expect(mcpSection, `${expectation.skillPath} MCP section is required`).not.toBeNull();
      for (const tool of extractToolNamesFromText(mcpSection!)) {
        mcpReferencedTools.add(tool);
      }
    }

    expect(mcpReferencedTools.size).toBeGreaterThan(0);

    for (const tool of mcpReferencedTools) {
      expect(
        declaredToolNames.has(tool),
        `${tool} is documented in skills but not declared in MCP server`
      ).toBe(true);
      expect(
        handlerNames.has(tool),
        `${tool} is declared but missing runtime handler switch case`
      ).toBe(true);
    }
  });

  it("v1 standalone skills do not accidentally document MCP execution as canonical path", () => {
    for (const expectation of V1_SKILL_EXPECTATIONS) {
      if (expectation.mode !== "standalone") continue;
      const content = readRepoFile(expectation.skillPath);
      expect(
        extractSection(content, "MCP Tools Used"),
        `${expectation.skillPath} should not claim MCP execution as canonical yet`
      ).toBeNull();
    }
  });
});
