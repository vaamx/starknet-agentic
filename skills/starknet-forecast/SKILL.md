---
name: starknet-forecast
description: Superforecasting methodology for AI agents on Starknet. Use multi-persona debate, autonomous tool-use research loops, calibrated probability estimation (Brier scoring), and on-chain reputation weighting to produce well-calibrated forecasts for any prediction market question.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [forecasting, superforecaster, probability, brier-score, calibration, multi-agent, debate, tool-use, prediction-market]
allowed-tools: [Bash, Read, Write, Task]
user-invocable: true
---

# Starknet Forecast Skill

Produce well-calibrated probability forecasts using multi-agent debate, autonomous tool-use research, and on-chain Brier scoring.

## Agent Personas

Five AI personas collaborate on every multi-agent forecast:

| Persona | ID | Bias | Best For |
|---------|----|------|---------|
| AlphaForecaster | `alpha` | Data-driven, quantitative | Crypto/DeFi markets |
| BetaAnalyst | `beta` | Qualitative, sentiment-aware | News/politics markets |
| GammaTrader | `gamma` | Contrarian, market-skeptical | Crowd-wisdom calibration |
| DeltaScout | `delta` | Speed-biased, momentum-focused | Sports/live events |
| EpsilonOracle | `epsilon` | Base-rate-anchored, Bayesian | General calibration |

## Single-Agent Forecast API

```typescript
// POST /api/predict
const response = await fetch("/api/predict", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ marketId: 3 }),
});

// Read SSE stream
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "text") process.stdout.write(event.content);
    if (event.type === "tool_call") console.log(`[TOOL] ${event.toolName}(${JSON.stringify(event.input)})`);
    if (event.type === "tool_result") console.log(`[RESULT] ${event.result.slice(0, 80)}`);
    if (event.type === "huginn_log") console.log(`[HUGINN] hash=${event.thoughtHash} tx=${event.huginnTxHash}`);
    if (event.type === "result") console.log(`\nFinal: ${(event.probability * 100).toFixed(1)}%`);
  }
}
```

### SSE Event Types (Single Agent)

| Event Type | Fields | Description |
|------------|--------|-------------|
| `text` | `content: string` | Reasoning text chunk |
| `tool_call` | `toolName, toolUseId, input` | Agent is calling a research tool |
| `tool_result` | `toolName, toolUseId, result, isError?` | Tool response |
| `huginn_log` | `thoughtHash, huginnTxHash?` | Reasoning logged on-chain |
| `result` | `probability, txHash?, txStatus, txError?, reasoningHash?, huginnTxHash?` | Final answer |
| `error` | `message` | Error during forecast |

## Multi-Agent Forecast API (Debate)

```typescript
// POST /api/multi-predict — runs all 5 personas + debate round
const response = await fetch("/api/multi-predict", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ marketId: 3 }),
});
```

### SSE Event Types (Multi-Agent)

| Event Type | Fields | Description |
|------------|--------|-------------|
| `agent_start` | `agentId, agentName, agentType, model` | Persona begins Round 1 |
| `text` | `agentId, content` | Persona reasoning chunk |
| `tool_call` | `agentId, toolName, toolUseId, input` | Tool call during research |
| `tool_result` | `agentId, toolName, toolUseId, result` | Tool result |
| `agent_complete` | `agentId, agentName, probability, brierScore` | Round 1 done |
| `debate_start` | — | Round 2 begins |
| `debate_text` | `agentId, content` | Debate reasoning chunk |
| `debate_complete` | `agentId, originalProbability, revisedProbability` | Agent revises estimate |
| `consensus` | `weightedProbability, simpleProbability, agentCount, agents[]` | Final consensus |

## Agentic Tool-Use Loop

When `AGENT_TOOL_USE_ENABLED=true` (default), each persona autonomously calls research tools:

### Available Research Tools

| Tool | Data Source | Requires |
|------|------------|---------|
| `web_search` | Tavily (AI answer) + Brave fallback | `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` |
| `get_polymarket_odds` | Polymarket Gamma API | None (public) |
| `get_crypto_prices` | CoinGecko | `COINGECKO_API_KEY` (optional) |
| `get_sports_data` | ESPN public API | None (public) |
| `get_starknet_onchain` | Starknet RPC | `STARKNET_RPC_URL` |
| `log_reasoning_step` | Internal checkpoint | None |

### Feature Flag

```bash
# Disable tool-use → revert to context-injection mode instantly
AGENT_TOOL_USE_ENABLED=false

# Max tool call rounds per forecast
AGENT_TOOL_MAX_TURNS=8
```

## Superforecasting Principles

1. **Base Rate First**: What's the historical frequency of this type of event?
2. **Inside View**: What specific evidence applies to this particular question?
3. **Outside View**: How do reference classes of similar predictions resolve?
4. **Update Gradually**: Don't overcorrect on single pieces of evidence
5. **Calibrate**: Move toward 50% if genuinely uncertain
6. **Track Record**: Brier scores show which agents are best-calibrated

## Reading Brier Scores

Brier Score = `(outcome - predicted_probability)²`

| Score | Quality |
|-------|---------|
| 0.000 | Perfect (never achievable in practice) |
| < 0.10 | Excellent calibration |
| 0.10–0.20 | Good calibration |
| 0.20–0.25 | Random baseline (uninformative) |
| > 0.25 | Worse than random |

Lower is better. Track each agent's rolling Brier score via:
```
prediction_get_leaderboard { trackerAddress: "0x...", marketId: 3 }
```

## Debate Mechanics

1. **Round 1**: Each persona independently forecasts, seeing only market data
2. **Round 2**: Each persona sees all Round 1 estimates and may revise
   - Look for "**Revised estimate: XX%**" in debate text
3. **Consensus**: Equal-weight average of Round 2 revised probabilities

Debate typically reduces variance and pushes estimates toward base rates.
