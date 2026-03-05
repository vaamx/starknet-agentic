# Skill ↔ MCP Integration Test Pattern

This directory validates that skill authoring stays aligned with MCP execution behavior.

## Scope (v1)

- Verify MCP-first skills include `## MCP Tools Used`.
- Verify standalone skills include `## Standalone Execution` rationale.
- Verify MCP tools documented by skills are:
  - declared in `packages/starknet-mcp-server/src/index.ts`
  - handled in runtime switch cases.
- Guard against standalone skills accidentally advertising MCP as canonical before tool support exists.

## Current Test

- `skill-mcp-alignment.test.ts`
  - `V1_SKILL_EXPECTATIONS` is the source of truth for skill mode (`mcp` vs `standalone`).
  - Extend this list when a new v1 skill is added or mode changes.
  - Current MCP-mode coverage includes `starknet-wallet`, `starknet-defi`, `starknet-identity`, and `starknet-mini-pay`.
- `standalone-skill-workflow.test.ts`
  - Verifies standalone rationale + script entrypoints remain intact for `starknet-anonymous-wallet`.
  - Prevents accidental regressions where standalone workflows lose required scripts.

## How to Extend for New Skills

1. Add the skill path and mode to `V1_SKILL_EXPECTATIONS`.
2. If mode is `mcp`, add/update the skill's `## MCP Tools Used` section.
3. If mode is `standalone`, add/update `## Standalone Execution (No MCP Tool Yet)`.
4. Run `pnpm run test:integration`.

## When to Add a New Integration Test File

Add a separate test file when behavior goes beyond doc/registration alignment, for example:

- end-to-end MCP tool invocation with fixture responses
- protocol-specific execution flows (e.g., mini-pay invoice lifecycle)
- migration checks when a skill moves from standalone to MCP-first
