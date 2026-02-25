# V1 Sprint Board (Agentic Prediction Market)

Snapshot date: 2026-02-24  
Branch context: `feat/prediction-market`

This board converts the v1 priorities into actionable tickets with owners, file targets, and blocker classification.

State legend:
- `pending`
- `in_progress`
- `in_review`
- `done`
- `blocked`

## Must-Finish for v1

| Ticket | State | Primary Owner | Support | File Targets | Acceptance Criteria | Blocker Type | Blocker |
|---|---|---|---|---|---|---|---|
| V1-1a: Complete `starknet-defi` skill depth | `in_review` | Skills Author | TypeScript Developer, Reviewer | `skills/starknet-defi/SKILL.md`, `skills/starknet-defi/README.md`, `skills/starknet-defi/scripts/*` | Includes full swap/staking/lending/DCA workflows, error codes + recovery, real addresses, MCP-first usage language, and Sepolia-first production defaults | `in_repo` | None |
| V1-1b: Complete `starknet-identity` skill depth | `in_review` | Skills Author | TypeScript Developer, Reviewer | `skills/starknet-identity/SKILL.md`, `skills/starknet-identity/README.md`, `skills/starknet-identity/scripts/*` | Includes end-to-end registration/reputation/validation, deployed Sepolia address matrix, and query examples | `in_repo` | None |
| V1-2a: Agent Passport spec documentation | `in_review` | TypeScript Developer | Skills Author, Reviewer | `docs/SPECIFICATION.md`, `packages/starknet-agent-passport/schemas/agent-passport.schema.json`, `packages/starknet-agent-passport/README.md`, `packages/starknet-agent-passport/src/index.ts` | Schema and conventions documented in spec; examples validated against schema | `in_repo` | None |
| V1-2b: Agent Passport adoption in skills/examples | `in_review` | TypeScript Developer | Skills Author, Reviewer | `skills/starknet-identity/SKILL.md`, `skills/starknet-identity/scripts/register-agent.ts`, `skills/starknet-identity/scripts/set-metadata.ts`, `examples/onboard-agent/*`, `examples/prediction-agent/app/lib/agent-identity.ts`, `examples/prediction-agent/app/api/well-known-agent-card/route.ts`, `examples/prediction-agent/app/api/well-known-agent/route.ts` | Identity flows consistently publish capability metadata using passport conventions | `in_repo` | None |
| V1-2c: Optional MCP passport helper tool | `in_review` | TypeScript Developer | Reviewer | `packages/starknet-mcp-server/src/index.ts`, `packages/starknet-mcp-server/__tests__/handlers/tools.test.ts`, `website/content/docs/api-reference/mcp-tools.mdx` | MCP helper tool added with schema + tests + docs | `in_repo` | None |
| V1-3a: Changelog automation | `in_review` | TypeScript Developer | Reviewer, Coordinator | `.github/workflows/release-please.yml`, `CHANGELOG.md`, `release-please-config.json`, `.release-please-manifest.json` | Automated changelog and release PR flow in CI | `in_repo` | None |
| V1-3b: Commitlint + contribution updates | `in_review` | TypeScript Developer | Reviewer | `commitlint.config.cjs`, `.github/workflows/commitlint.yml`, `CONTRIBUTING.md` | Commit linting enforced in CI, contribution guide aligned | `in_repo` | None |
| V1-3c: Workspace versioning workflow | `in_review` | TypeScript Developer | Reviewer | `.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`, `package.json` | Monorepo version bump strategy documented and automated | `in_repo` | None |
| V1-4a: HuginnRegistry production deployment path | `in_progress` | Cairo Developer | Coordinator, Reviewer | `contracts/huginn-registry/*`, `contracts/huginn-registry/scripts/*` (new), `docs/SOVEREIGN_AGENT.md`, `skills/huginn-onboard/SKILL.md` | Reproducible deployment path and verified production address publication flow | `external_dependency` | Scripted Sepolia path complete; pending live deployment execution + operator sign-off |
| V1-4b: Mainnet onboarding docs | `pending` | Cairo Developer | Coordinator, Reviewer | `examples/onboard-agent/config.ts`, `examples/onboard-agent/README.md`, `docs/GETTING_STARTED.md`, `skills/huginn-onboard/SKILL.md` | Mainnet-safe onboarding guide with explicit preflight/funding/rollback notes | `external_dependency` | Depends on finalized production contract addresses |
| V1-5a: MCP ↔ Skill section normalization | `in_review` | Skills Author | TypeScript Developer, Reviewer | `skills/starknet-wallet/SKILL.md`, `skills/starknet-defi/SKILL.md`, `skills/starknet-identity/SKILL.md`, `skills/starknet-anonymous-wallet/SKILL.md`, `skills/huginn-onboard/SKILL.md` | Every shipped skill has `MCP Tools Used` or explicit standalone rationale | `in_repo` | None |
| V1-5b: Cross-skill integration tests | `in_review` | TypeScript Developer | Skills Author, Reviewer | `tests/integration/*` (new), `packages/starknet-mcp-server/__tests__/*` | Integration tests validate skill guidance aligns with MCP execution | `in_repo` | None |
| V1-5c: Architecture docs alignment | `in_review` | Skills Author | TypeScript Developer, Reviewer | `docs/SPECIFICATION.md`, `CLAUDE.md`, `skills/README.md` | Clear authoring guidance for MCP vs bundled execution boundaries | `in_repo` | None |
| V1-6a: Prediction-agent launch preflight automation | `in_review` | TypeScript Developer | Reviewer | `examples/prediction-agent/scripts/preflight.sh`, `examples/prediction-agent/README.md`, `examples/prediction-agent/LAUNCH_CHECKLIST.md`, `.github/workflows/ci.yml` | One-command preflight validates env/test/build and CI validates env template before launch gate build/test | `in_repo` | None |
| V1-6b: Prediction-agent deployed smoke automation | `in_review` | TypeScript Developer | Reviewer | `examples/prediction-agent/scripts/smoke-deployed.mjs`, `examples/prediction-agent/README.md`, `examples/prediction-agent/LAUNCH_CHECKLIST.md` | One-command deployed smoke validates health/status/heartbeat/manifests/predict path with actionable warnings | `in_repo` | None |

## Can Defer to v2

| Workstream | Owner | Support | Entry Criteria to Start |
|---|---|---|---|
| Framework extensions (Daydreams/Lucid) | TypeScript Developer | Coordinator, Reviewer | v1 launch complete and stable MCP identity + skills shipped |
| Full A2A lifecycle expansion | TypeScript Developer | Reviewer | v1 onboarding metrics stable, discovery baseline validated |
| Cross-chain identity bridge | Cairo Developer | TypeScript Developer, Reviewer | Mainnet identity contracts stable with documented migration path |
| zkML integration (Giza/LuminAIR) | Cairo Developer | TypeScript Developer, Reviewer | Core prediction loop and verification telemetry stable |
| Nested session keys | Cairo Developer | Reviewer | Security review capacity allocated post-v1 |
| Agent insurance pools | Cairo Developer | Coordinator, Reviewer | Reputation and claims telemetry mature |
| Economy apps (AgentSouk/ProveWork/StarkMint) | TypeScript Developer | Cairo Developer, Coordinator | Core infra adoption and operational bandwidth available |

## External Dependency Blockers

| Blocked Item | Current Blocker | Owner for Escalation | Next Action |
|---|---|---|---|
| HuginnRegistry production deployment | Deployment credentials and network change control are not in-repo | Coordinator | Schedule deployment window + key custody approval |
| Mainnet onboarding docs finalization | Mainnet addresses and rollout strategy not finalized | Coordinator | Finalize canonical address set and update docs in one pass |

## Recommended Execution Order (Now)

1. V1-1a + V1-1b + V1-2a + V1-2b + V1-2c + V1-3a + V1-3b + V1-3c (all in_review: verify in CI + merge)
2. V1-5a + V1-5c (architecture alignment: both in_review)
3. V1-5b + V1-6a + V1-6b (in_review: verify CI + merge)
4. V1-4a + V1-4b (deployment/doc tasks requiring external coordination)
