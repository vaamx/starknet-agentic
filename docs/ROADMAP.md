# Roadmap

Feature roadmap for Starknet Agentic infrastructure, broken into MVP, Nice-to-have, and Future phases.

> **Note:** Website-specific features are tracked in `website/docs/ROADMAP.md`.

---

## Prompt Initialization

Hey, I am working to implement features for Starknet Agentic from the roadmap. Let's continue with implementing:

---

# Phase 1: MVP

Core infrastructure features required for v1.0 release. MVP definition: MCP server + skills working (agents can transact via MCP tools).

---

### 1.2 Publish Skills to Distribution Channels

**Description**: Publish all complete skills to GitHub, ClawHub, and other channels for maximum distribution.

**Requirements**:
- [x] Register/Setup Publication for `@starknet-agentic/skill-wallet`
- [x] Register/Setup Publication for `@starknet-agentic/skill-defi`
- [x] Register/Setup Publication for `@starknet-agentic/skill-identity`
- [x] Register/Setup Publication for `@starknet-agentic/skill-mini-pay`
- [x] Register/Setup Publication for `@starknet-agentic/skill-anonymous-wallet`
- [x] Register/Setup Publication for `@starknet-agentic/huginn-onboard`
- [ ] Publish skills to ClawHub for OpenClaw/MoltBook users (blocked: CLI not on npm, publishing workflow undocumented)
- [x] Update skills README with installation instructions for all channels
- [x] Set up automated publishing in CI workflow

**Implementation Notes**:
- Skills are complete in `skills/` directory with standardized frontmatter
- Claude Code plugin manifest at `.claude-plugin/marketplace.json`
- CI validation workflow added to `.github/workflows/ci.yml`
- Skills README at `skills/README.md` with installation instructions
- Monorepo approach chosen: all skills in one repo, installable individually or together
- ClawHub blocked: CLI not published to npm, publishing workflow not documented

**Distribution Channels**:
- GitHub: `npx skills add keep-starknet-strange/starknet-agentic`
- Claude Code: `/plugin marketplace add keep-starknet-strange/starknet-agentic`
- skills.sh: Auto-indexed from GitHub
- ClawHub: Blocked (check clawhub.ai for updates)

---

### 1.3 Agent Passport as Standard Capability Metadata

**Description**: Standardize agent-passport as the convention for agents to describe their capabilities via ERC-8004 metadata.

**Requirements**:
- [x] Document agent-passport schema in SPECIFICATION.md
- [x] Create JSON schema for capability metadata validation
- [x] Add capability metadata examples to skills documentation
- [x] Update starknet-identity skill to use agent-passport for registration
- [x] Add agent-passport integration to MCP server (optional helper tool)
- [x] Write migration guide for existing ERC-8004 agents

**Implementation Notes**:
- Core package + schema: `packages/starknet-agent-passport/src/index.ts`, `packages/starknet-agent-passport/schemas/agent-passport.schema.json`
- Spec standard added at `docs/SPECIFICATION.md` section `3.9 Agent Passport Metadata Standard`
- Skill examples and operational scripts aligned in `skills/starknet-identity/SKILL.md` and `skills/starknet-identity/scripts/*`
- Example A2A manifests expose passport metadata in `examples/prediction-agent/app/api/well-known-agent*.ts`
- MCP helper tool shipped: `starknet_get_agent_passport` in `packages/starknet-mcp-server/src/index.ts`

---

### 1.5 Auto-Generated Changelog Setup

**Description**: Set up automated changelog generation from conventional commits.

**Requirements**:
- [x] Install and configure release-please or semantic-release
- [x] Create CHANGELOG.md in repository root
- [x] Configure conventional commit linting (commitlint)
- [x] Add commit message format to CONTRIBUTING.md
- [x] Set up GitHub Action for automated changelog updates
- [x] Configure version bumping for packages (pnpm workspaces aware)

**Implementation Notes**:
- Use conventional commits format: `feat:`, `fix:`, `docs:`, `chore:`
- release-please workflow added at `.github/workflows/release-please.yml`
- commitlint workflow added at `.github/workflows/commitlint.yml`
- release manifest/config tracked in `.release-please-manifest.json` and `release-please-config.json`
- root changelog initialized at `CHANGELOG.md`

---

### 1.6 Complete starknet-defi Skill Implementation

**Description**: The starknet-defi skill is currently a template. Complete the implementation with full documentation and examples.

**Requirements**:
- [ ] Add comprehensive swap documentation (avnu patterns)
- [ ] Add staking documentation (STRK staking, liquid staking)
- [ ] Add lending documentation (zkLend, Nostra patterns)
- [ ] Add DCA (Dollar Cost Averaging) documentation
- [ ] Create example scripts for each operation
- [ ] Add error handling guide with recovery steps
- [ ] Include token addresses and protocol endpoints

**Implementation Notes**:
- `skills/starknet-defi/` now includes production-depth docs + scripts for quote/swap/depth/staking/dca
- MCP-first guidance is explicit, with direct SDK usage scoped to non-MCP capabilities
- v1 launch defaults are Sepolia-first; mainnet-specific activation is deferred

---

### 1.7 Complete starknet-identity Skill Implementation

**Description**: The starknet-identity skill has structure but needs ERC-8004 integration details.

**Requirements**:
- [x] Add agent registration workflow documentation
- [x] Add reputation system usage guide
- [x] Add validation request/response documentation
- [x] Add metadata schema reference
- [x] Create example scripts for identity operations
- [x] Document deployed contract addresses (Sepolia v1 baseline)
- [x] Add querying reputation and validation status examples

**Implementation Notes**:
- Basic structure exists at `skills/starknet-identity/SKILL.md` (303 lines)
- ERC-8004 contracts are production-ready in `contracts/erc8004-cairo/`
- Include agent-passport integration

---

### 1.8 Standardize MCP ↔ Skill Architecture Separation

**Description**: Align all skills with 2025-2026 best practices for the MCP (capability layer) vs Skills (knowledge layer) separation. Currently, skills vary in how they relate to the MCP server—some document MCP tools (ideal), some bundle standalone execution (acceptable for missing capabilities), and some are complete standalone apps (should be refactored).

**Background** (from architecture analysis):
- **Best practice**: Skills provide "context, instructions, domain knowledge, and behavioral patterns"—MCP tools provide executable functions. Skills teach *when/what*, MCP executes *how*.
- **Token economics**: One MCP server can consume 50k+ tokens of schemas; skills use progressive disclosure (~100 tokens metadata, ~5k when activated).
- **Industry alignment**: AgentSkills spec (agentskills.io) + MCP (donated to Linux Foundation AAIF) are complementary standards adopted by Microsoft, OpenAI, Cursor, GitHub, etc.

**Current State Assessment**:

| Skill | Pattern | Best Practice Alignment |
|-------|---------|-------------------------|
| `starknet-wallet` | Documents 8 MCP tools, minimal validation scripts | ✅ 100% - Ideal separation |
| `starknet-defi` | Documents MCP swap/quote tools, SDK patterns | ✅ 95% - Good separation |
| `starknet-identity` | MCP identity tools + direct reputation/validation patterns | ✅ 90% - Near complete |
| `starknet-anonymous-wallet` | Bundles Node.js scripts (Typhoon not in MCP) | ⚠️ 60% - Valid deviation |
| `starknet-mini-pay` | MCP tools for links/invoices/QR + standalone Python app fallback | ✅ 85% - Hybrid aligned |
| `huginn-onboard` | Standalone onboarding workflow (no MCP tool yet) | ⚠️ 70% - Documented deviation |

**Requirements**:

#### 1.8.1 starknet-wallet (Reference Implementation)
- [x] Documents MCP tools in skill body
- [x] Provides TypeScript code examples
- [x] Bundles only validation scripts (`scripts/check-balance.ts`, `scripts/check-balances.ts`)
- [x] Add explicit "MCP Tools Used" section with tool schemas
- [x] Add integration test: skill + MCP server working together
- [x] Document as reference implementation for other skills

#### 1.8.2 starknet-defi (Minor Improvements)
- [x] Documents MCP swap/quote tools
- [x] Comprehensive avnu SDK patterns
- [x] Add explicit "MCP Tools Used" section listing `starknet_swap`, `starknet_get_quote`
- [x] Add integration test: DeFi skill guiding agent to use MCP swap tools
- [x] Verify all code examples use MCP tool patterns (not direct SDK calls for operations MCP exposes)

#### 1.8.3 starknet-identity (Complete Implementation)
- [x] Complete skill implementation (see 1.7)
- [x] Document which operations should be MCP tools vs skill knowledge
- [x] Add "MCP Tools Used" section (pending 2.2 MCP Identity Tools)
- [x] Ensure skill teaches patterns, doesn't duplicate MCP execution logic

#### 1.8.4 starknet-anonymous-wallet (Document Deviation)
- [x] Bundles scripts because Typhoon protocol not in MCP server
- [x] Add explicit note: "This skill bundles execution because Typhoon is not exposed via MCP"
- [x] Evaluate: Should Typhoon operations be added to MCP server?
  - If yes: Create issue to add `starknet_typhoon_deposit`, `starknet_typhoon_withdraw` tools
  - If no: Document rationale (specialized use case, different security model, etc.)
- [x] Add integration test for script-based workflow

#### 1.8.5 starknet-mini-pay (Refactor to MCP Pattern)
- [x] **Add payment operations to MCP server**:
  - [x] `starknet_create_payment_link` - Generate `starknet:<addr>?amount=...` links
  - [x] `starknet_parse_payment_link` - Parse incoming payment links
  - [x] `starknet_create_invoice` - Create payment request with expiry
  - [x] `starknet_get_invoice_status` - Check invoice fulfillment
  - [x] `starknet_generate_qr` - Generate QR code payload for address/payment (base64/data URL)
- [x] **Refactor skill to document MCP tools** (like starknet-wallet does)
- [x] **Keep Telegram bot as separate deployment** that consumes MCP server
- [x] **Maintain Python scripts** as alternative runtime (document as "standalone mode")
- [x] Add integration test: skill + MCP payment tools

#### 1.8.6 huginn-onboard (Review and Align)
- [x] Review current implementation
- [x] Determine if it documents MCP tools or bundles execution
- [x] Align with starknet-wallet pattern if applicable
- [x] Add integration test

#### 1.8.7 Cross-Skill Integration Testing
- [x] Create `tests/integration/` directory for skill + MCP tests
- [x] Test: Agent loads starknet-wallet skill → uses MCP tools correctly
- [x] Test: Agent loads starknet-defi skill → executes swap via MCP
- [x] Test: Agent loads starknet-mini-pay skill → creates payment link via MCP
- [x] Document test patterns for community skill authors

#### 1.8.8 Documentation Updates
- [x] Add "MCP ↔ Skill Architecture" section to SPECIFICATION.md
- [x] Document when to add capability to MCP vs bundle in skill
- [x] Add skill authoring guide with best practices
- [x] Update CLAUDE.md with architecture guidance

**Implementation Notes**:
- starknet-wallet is the reference implementation—other skills should follow its pattern
- Skills that bundle execution (anonymous-wallet, mini-pay) should document *why*
- MCP server changes require Zod schemas, tests, and documentation updates
- Telegram bot in mini-pay is a valid standalone deployment—it can consume MCP server
- Python scripts in mini-pay can remain as "standalone mode" for non-MCP environments

**Acceptance Criteria**:
- All skills have explicit "MCP Tools Used" section (or "Standalone Execution" with rationale)
- Integration tests pass for each skill + MCP combination
- SPECIFICATION.md documents the architecture pattern
- New skill authors have clear guidance on MCP vs bundled execution

**Priority**: MEDIUM - Improves maintainability and aligns with industry standards, but current skills are functional.

**References**:
- [Anthropic: Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic: Equipping Agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Skills vs Tools Production Guide](https://blog.arcade.dev/what-are-agent-skills-and-tools)

---

# Phase 2: Nice to Have

Features that enhance the platform but are not required for v1.0 release.

---

### 2.1 Agent Account Contract Deployment

**Description**: The Agent Account contract is fully tested (110 tests across 4 suites) and deployed on Sepolia. Next step is mainnet deployment readiness and operations hardening.

**Requirements**:
- [x] ~~Create tests directory~~ — 4 test files exist in `contracts/agent-account/tests/`
- [x] ~~Write snforge tests for session key registration~~
- [x] ~~Write snforge tests for session key revocation~~
- [x] ~~Write snforge tests for spending limit enforcement~~
- [x] ~~Write snforge tests for time bounds validation~~
- [x] ~~Write snforge tests for emergency revoke mechanism~~
- [x] ~~Write snforge tests for agent ID linking~~
- [x] Create Sepolia deployment script
- [x] Deploy to Sepolia testnet
- [x] Document deployed contract address
- [ ] Deploy AgentAccountFactory to mainnet

**Implementation Notes**:
- Contract at `contracts/agent-account/src/agent_account.cairo` (~570 lines)
- Tests: test_agent_account (43), test_execute_validate (20), test_security (33), test_agent_account_factory (14)
- Uses OpenZeppelin AccountComponent
- Single-level session keys (owner -> agent, no nested delegation)
- Use starkli in the deployment script. Follow this as an example: https://github.com/keep-starknet-strange/pow/tree/main/onchain/scripts ( see deploy-sepolia.sh, deploy-mainnet.sh, ... )

---

### 2.2 MCP Identity Tools Implementation

**Description**: Add identity-related MCP tools for on-chain agent registration and reputation.

**Requirements**:
- [x] Implement `starknet_register_agent` tool
- [x] Implement `starknet_get_agent_info` tool
- [x] Implement `starknet_update_agent_metadata` tool
- [x] Implement `starknet_give_feedback` tool
- [x] Implement `starknet_get_reputation` tool
- [x] Implement `starknet_request_validation` tool
- [x] Add Zod schemas for all new tools
- [x] Write tests for each tool
- [x] Update MCP tools documentation

**Implementation Notes**:
- These tools interact with ERC-8004 contracts
- Requires deployed contract addresses in environment (`ERC8004_IDENTITY_REGISTRY_ADDRESS`, `ERC8004_REPUTATION_REGISTRY_ADDRESS`, `ERC8004_VALIDATION_REGISTRY_ADDRESS`)
- Lower priority than transaction tools for MVP

---

### 2.3 Generalized Messaging Skill

**Description**: Abstract mini-pay's Telegram bot pattern into a generalized messaging skill supporting multiple platforms.

**Requirements**:
- [ ] Design messaging skill interface (platform-agnostic)
- [ ] Extract Telegram integration from mini-pay as plugin
- [ ] Add Discord bot integration plugin
- [ ] Add Slack integration plugin (optional)
- [ ] Create unified notification API
- [ ] Document bot deployment patterns
- [ ] Add rate limiting and spam prevention

**Implementation Notes**:
- mini-pay has working Telegram bot (684 lines in `telegram_bot.py`)
- Pattern should support: payment notifications, balance alerts, transaction confirmations
- Consider using message queue for reliability

---

### 2.4 A2A Protocol Full Implementation

**Description**: Expand A2A adapter with complete task protocol and discovery.

**Requirements**:
- [ ] Implement full A2A task lifecycle (submitted -> working -> completed/failed)
- [ ] Add Agent Card generation from ERC-8004 metadata
- [ ] Implement `/.well-known/agent.json` endpoint
- [ ] Add agent discovery via registry queries
- [ ] Implement task negotiation protocol
- [ ] Add payment channel support for recurring tasks
- [ ] Write integration tests

**Implementation Notes**:
- Basic adapter exists at `packages/starknet-a2a/` (437 lines)
- A2A tasks map to Starknet transactions
- Consider WebSocket support for real-time updates

---

### 2.5 CI/CD Enhancements

**Description**: Improve CI/CD pipeline with additional checks and automation.

**Requirements**:
- [x] ~~Add Cairo contract build verification to CI~~ — done in `ci.yml` (erc8004, agent-account, huginn-registry)
- [x] ~~Add snforge test execution to CI~~ — done in `ci.yml` (3 separate Cairo test jobs)
- [x] ~~Add automated npm publishing on release~~ — done in `publish.yml`
- [x] ~~Add skill validation to CI~~ — done in `ci.yml` (`validate-skills` job)
- [x] ~~Add onboarding smoke tests to CI~~ — done in `ci.yml` (`onboarding-smoke` job)
- [x] ~~Add dependency vulnerability scanning~~
- [x] ~~Add daily health check cron~~ — done in `health-check.yml`
- [ ] Add starknet.js version consistency check
- [ ] Add automated ClawHub publishing on release
- [ ] Add test coverage reporting

**Implementation Notes**:
- CI pipeline at `.github/workflows/ci.yml` runs 11 jobs: typecheck, lint, test, 3x cairo-test, website-build, validate-skills, onboarding-smoke, all-checks
- `publish.yml` publishes 3 packages to npm on release (mcp-server, a2a, agent-passport)
- `health-check.yml` runs daily at 9:15 UTC, creates GitHub issues on failure

---

### 2.6 Starkzap Execution Surface Integration

**Description**: Add Starkzap as a first-class DeFi execution surface while keeping authorization and policy enforcement in starknet-agentic contracts and session key controls.

**Requirements**:
- [ ] Define execution-surface abstraction (`starkzap` | `avnu` | direct invoke) in MCP layer
- [ ] Implement Starkzap-backed transfer/swap adapter behind feature flag
- [ ] Preserve AVNU path as default until parity checks pass
- [ ] Add provider parity tests (quote/execution/error mapping)
- [ ] Add reproducibility harness for Sepolia adversarial proof flows
- [ ] Document execution vs authorization separation in SPECIFICATION and GETTING_STARTED

**Implementation Notes**:
- Upstream report indicates Starkzap was used in an adversarial Sepolia demo where oversized spend and forbidden selectors were blocked by policy controls.
- Track source links and verification notes in `docs/UPSTREAM_SYNC_2026-03-05.md`.
- Integrate incrementally: adapter + tests first, default switch only after stability and security review.

---

# Phase 3: Future

Long-term features and ecosystem expansion planned for v2.0+.

---

### 3.1 Framework Extensions (Daydreams, Lucid Agents)

**Description**: Create native extensions for popular agent frameworks.

**Requirements**:
- [ ] Design Daydreams extension interface following their `extension()` pattern
- [ ] Implement StarknetProvider service for Daydreams
- [ ] Implement wallet context for Daydreams
- [ ] Implement DeFi actions (transfer, swap, stake) for Daydreams
- [ ] Design Lucid Agents WalletConnector interface
- [ ] Implement StarknetWalletConnector for Lucid Agents
- [ ] Implement PaymentsRuntime for Lucid Agents
- [ ] Write documentation and examples for both frameworks
- [ ] Publish as separate npm packages

**Implementation Notes**:
- Low priority for v1.0 (MCP covers most use cases)
- Daydreams pattern: services, contexts, actions, inputs, outputs
- Lucid Agents pattern: Extension interface with WalletConnector
- Consider deferring to community contributions

---

### 3.2 Economy Apps (AgentSouk, ProveWork, StarkMint)

**Description**: Build the apps described in AGENTIC_ECONOMY_PLAN.md on top of the infrastructure.

**Requirements**:
- [ ] Design AgentSouk marketplace architecture
- [ ] Design ProveWork trustless labor market
- [ ] Design StarkMint token launchpad
- [ ] Create shared contracts for escrow and bonding curves
- [ ] Implement AgentSouk MVP (agent profiles, search, discovery)
- [ ] Implement ProveWork MVP (task posting, bidding, escrow)
- [ ] Implement StarkMint MVP (token launch, bonding curves)

**Implementation Notes**:
- These are planned products, not just vision docs
- Build on Agent Account, ERC-8004, and MCP server
- Consider separate repositories or monorepo apps/ directory
- May involve community bounties for implementation

---

### 3.3 Cross-Chain Identity Bridge

**Description**: Bridge ERC-8004 identity between Starknet and EVM chains.

**Requirements**:
- [ ] Design bridge protocol for identity attestations
- [ ] Implement Starknet -> EVM message passing
- [ ] Implement EVM -> Starknet message passing
- [ ] Create bridge contracts on both sides
- [ ] Handle identity verification across chains
- [ ] Document bridge usage patterns

**Implementation Notes**:
- Open question: how should reputation transfer across chains?
- Consider Starknet's native L1 messaging
- May use StarkGate or custom bridge

---

### 3.4 zkML Integration (Giza LuminAIR)

**Description**: Integrate Giza's zkML for verifiable AI agent decisions.

**Requirements**:
- [ ] Research Giza LuminAIR API and capabilities
- [ ] Design integration pattern for agent decision proofs
- [ ] Implement proof generation for trading decisions
- [ ] Implement on-chain proof verification
- [ ] Add zkML attestation to ERC-8004 validation
- [ ] Create example: "Proof-of-Agency" autonomous action verification

**Implementation Notes**:
- Open question: what agent decisions should be provable?
- Giza enables proving ML inference on-chain
- Unique to Starknet (ZK-STARK native)

---

### 3.5 Nested Session Keys (Recursive Agent Swarms)

**Description**: Allow agents to delegate to sub-agents with scoped-down session keys.

**Requirements**:
- [ ] Design nested delegation protocol
- [ ] Implement sub-session key creation in Agent Account contract
- [ ] Add permission intersection logic (sub-key can only narrow, not expand)
- [ ] Add depth limits to prevent infinite delegation
- [ ] Implement swarm dissolution cleanup
- [ ] Write security analysis document

**Implementation Notes**:
- Currently single-level only (owner -> agent)
- Open question: security implications of recursive delegation
- Use case: "Project Manager" agent spawns specialized sub-agents

---

### 3.6 Agent Insurance Pools

**Description**: Decentralized insurance for agent mistakes with reputation-based premiums.

**Requirements**:
- [ ] Design insurance pool contracts
- [ ] Implement premium calculation based on reputation
- [ ] Implement claim verification via on-chain history
- [ ] Add stake-based coverage limits
- [ ] Create governance for pool parameters
- [ ] Document actuarial model

**Implementation Notes**:
- Novel concept only possible on Starknet (provable history)
- Requires mature reputation system
- May need oracle for off-chain claim verification

---

### 3.7 Open Question Resolution

**Description**: Resolve design questions listed in SPECIFICATION.md.

**Items to Resolve**:
- [ ] Cross-chain identity: how should EVM ERC-8004 and Starknet registry interoperate?
- [ ] Micropayments: what is the right economic model for agent-to-agent micropayments?
- [ ] Skill versioning: how should skills be versioned and how should upgrades be handled?
- [ ] Contract upgrades: which contracts should be upgradeable vs. immutable? (case-by-case documented)

**Implementation Notes**:
- Each decision should be documented in SPECIFICATION.md
- May require community input via GitHub discussions
- Some decisions may be deferred to implementation experience

---

### 1.9 Agent Onboarding E2E Flow

**Status**: IN PROGRESS

**Description**: End-to-end onboarding flow for new agents including account deployment, ERC-8004 registration, and first action. Demonstrated via `examples/onboard-agent/` and `examples/crosschain-demo/`.

**Implemented**:
- [x] `examples/onboard-agent/` -- E2E onboarding flow with network/gasfree/verify options
- [x] `examples/crosschain-demo/` -- Base Sepolia ↔ Starknet ERC-8004 cross-chain flow
- [x] AVNU-sponsored gasfree deploy path (PR #140)
- [x] Cross-chain funding logic with threshold/skip+mock (PR #155)
- [x] Onboarding smoke tests in CI (`onboarding-smoke` job)
- [x] `skills/huginn-onboard/` -- Huginn onboarding skill
- [x] Sepolia deployment path for `HuginnRegistry` (`contracts/huginn-registry/scripts/deploy_sepolia.sh`, `verify_sepolia.sh`, `deployments/sepolia.json`)
- [ ] Production deployment of HuginnRegistry contract
- [ ] Mainnet onboarding documentation

**Implementation Notes**:
- Onboard agent: preflight checks → account deployment → identity registration → first action
- Crosschain demo: EVM funding → bridge → Starknet registration → URI update
- Smoke tests run in CI to prevent regressions

---

## Implementation Priority Summary

| Phase | Target | Key Deliverables |
|-------|--------|------------------|
| **MVP (v1.0)** | Q1 2026 | CLI scaffolding ✅, skill publishing, agent onboarding, defi/identity skill completion, changelog |
| **Nice to Have (v1.x)** | Q2 2026 | Agent Account deployment, identity MCP tools, A2A expansion, messaging |
| **Future (v2.0+)** | 2026+ | Framework extensions, economy apps, cross-chain bridge, zkML |

---

## Status Legend

- `[ ]` Not started
- `[x]` Complete
- `[~]` In progress

*Last updated: 2026-02-24*
