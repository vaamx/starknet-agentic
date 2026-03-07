---
name: starknet-guilds
description: Create and manage agent DAOs (guilds) on Starknet with stake-weighted governance
keywords:
  - starknet
  - guilds
  - dao
  - governance
  - agent-coordination
  - staking
allowed-tools:
  - guild_create
  - guild_join
  - guild_leave
  - guild_propose
  - guild_vote
  - guild_execute
user-invocable: false
---

# Agent Guilds — Agent DAOs on Starknet

Agent Guilds enable AI agents to form decentralized autonomous organizations with stake-weighted governance. Members stake STRK to join, vote on proposals proportional to their stake, and share in guild earnings.

## Guild Lifecycle

```
CREATE → JOIN (stake STRK) → PROPOSE → VOTE → EXECUTE
                └── LEAVE (reclaim stake)
```

## MCP Tools Used

### Create a Guild

```
guild_create
  registryAddress: "0x..."
  nameHash: "0xabc..."     # felt252 hash of guild name
  minStake: "100"           # Minimum 100 STRK to join
```

### Join a Guild

```
guild_join
  registryAddress: "0x..."
  guildId: "1"
  stakeAmount: "200"        # Must be >= minStake
```

### Create a Proposal

```
guild_propose
  daoAddress: "0x..."
  guildId: "1"
  descriptionHash: "0xdef..."
  quorum: "500"             # Total vote weight needed
  deadline: 1720000000      # Voting deadline
```

### Vote

```
guild_vote
  daoAddress: "0x..."
  proposalId: "1"
  support: true             # true = YES, false = NO
```

### Execute Passed Proposal

```
guild_execute
  daoAddress: "0x..."
  proposalId: "1"
```

### Leave Guild

```
guild_leave
  registryAddress: "0x..."
  guildId: "1"
```

## Error Codes

| Error | Recovery |
|-------|----------|
| `stake below minimum` | Stake amount must be ≥ guild's min_stake |
| `already a member` | Cannot join a guild you already belong to |
| `not a member` | Must be a guild member to leave or vote |
| `not a guild member` | Must be a member to propose or vote |
| `already voted` | Each member can only vote once per proposal |
| `voting ended` | Cannot vote after proposal deadline |
| `voting not ended` | Cannot execute before deadline passes |
| `proposal not active` | Proposal must be Active to vote/execute/cancel |
| `only proposer can cancel` | Only the original proposer can cancel |

## Architecture

- **GuildRegistry**: Guild creation, membership, staking
- **GuildDAO**: Proposals, stake-weighted voting, execution
- **Planned**: ERC-8004 identity verification for membership (not yet enforced in v1)
- **Planned**: TaskEscrow integration to route tasks to guild members
