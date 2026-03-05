---
name: starknet-research
description: Access 12 real-world data sources for prediction research. Fetch live crypto prices (CoinGecko), Polymarket odds, ESPN sports data, web search (Tavily/Brave), news headlines, GitHub trends, Starknet on-chain metrics, RSS feeds, X trends, and Telegram signals. Each source fails gracefully with empty results when API keys are absent.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [research, polymarket, coingecko, espn, tavily, brave, crypto, starknet, github, rss, data-sources]
allowed-tools: [Bash, Read, Write]
user-invocable: true
---

# Starknet Research Skill

Access 12 real-world data sources for prediction market research. All sources fail gracefully — missing API keys return empty results rather than errors.

## Data Sources

| Source | ID | Status | Requires | Data Type |
|--------|-----|--------|---------|-----------|
| Polymarket | `polymarket` | Active | None | Crowd prediction odds |
| CoinGecko | `coingecko` | Active | `COINGECKO_API_KEY` (optional) | Crypto prices + 24h change |
| News | `news` | Active | `BRAVE_SEARCH_API_KEY` | News headlines |
| Web (Brave) | `web` | Active | `BRAVE_SEARCH_API_KEY` | Web search results |
| Tavily | `tavily` | Active | `TAVILY_API_KEY` | AI-synthesized search answer |
| ESPN | `espn` | Active | None | Live sports scores |
| Social | `social` | Stub | None | Social sentiment (placeholder) |
| GitHub | `github` | Active | `GITHUB_TOKEN` | Trending repos |
| On-chain | `onchain` | Active | `STARKNET_RPC_URL` | Starknet metrics |
| RSS | `rss` | Active | `RSS_SOURCES` | RSS feed items |
| X (Twitter) | `x` | Active | `X_BEARER_TOKEN` | X trends + posts |
| Telegram | `telegram` | Active | `TELEGRAM_BOT_TOKEN` | Channel messages |

## DataSourceResult Interface

```typescript
interface DataPoint {
  label: string;
  value: string | number;
  url?: string;
  confidence?: number;
}

interface DataSourceResult {
  source: string;       // e.g. "polymarket", "coingecko"
  query: string;        // The question/query used
  timestamp: number;    // Unix ms
  data: DataPoint[];    // Up to 5 data points
  summary: string;      // Human-readable summary string
}
```

## Usage Examples

### Gather Research from Multiple Sources

```typescript
import { gatherResearch, buildResearchBrief } from "@/lib/data-sources/index";

const results = await gatherResearch(
  "Will STRK exceed $0.15 by March 2026?",
  ["coingecko", "polymarket", "onchain", "news"]
);

// Build a formatted brief for Claude injection
const brief = buildResearchBrief(results);
console.log(brief);
// Output:
// ## Real-World Research Data (gathered 2026-02-20T10:00:00.000Z)
//
// ### COINGECKO Data
// Found 1 crypto price data points...
//   - STRK/USD: $0.132 (24h: -2.3%)
//
// ### POLYMARKET Data
// Found 2 Polymarket markets...
//   - STRK above $0.15: 28%
```

### Use Individual Fetchers

```typescript
import { fetchTavilySearch } from "@/lib/data-sources/tavily";
import { fetchCryptoPrices } from "@/lib/data-sources/crypto-prices";
import { fetchPolymarketData } from "@/lib/data-sources/polymarket";
import { fetchEspnScores } from "@/lib/data-sources/espn-live";
import { fetchStarknetOnchain } from "@/lib/data-sources/starknet-onchain";

// Tavily: AI-synthesized answer (best for tool-use loops)
const tavilyResult = await fetchTavilySearch("Super Bowl LX final score");
// Returns: { summary: "Tavily answer: ...", data: [{ label, value, url }] }

// CoinGecko: prices
const priceResult = await fetchCryptoPrices("ethereum,starknet");
// Returns: { summary: "Found 2 crypto prices", data: [{ label: "STRK/USD", value: "$0.132" }] }

// Polymarket: crowd odds
const polyResult = await fetchPolymarketData("STRK price above $0.15");
// Returns: { summary: "Found 1 Polymarket market", data: [{ label: "Market", value: "28%" }] }

// ESPN: sports scores
const espnResult = await fetchEspnScores("NFL Super Bowl");
// Returns: { summary: "Found 2 active NFL games", data: [{ label: "Chiefs vs Eagles", value: "21-14" }] }
```

### Tavily vs. Brave Web Search

| Feature | Tavily | Brave |
|---------|--------|-------|
| Response format | AI-synthesized answer + snippets | Raw result list |
| Token count | Low (ideal for tool-use) | Higher |
| Best for | Agentic tool-use loops | Batch pre-fetch context |
| Env var | `TAVILY_API_KEY` | `BRAVE_SEARCH_API_KEY` |
| Timeout | 8 seconds | 5 seconds |

In agentic mode, `web_search` tool tries Tavily first, falls back to Brave.
In batch mode (`gatherResearch()`), Brave (`web`) and Tavily can both be included.

## Environment Variables

```bash
# Web search
TAVILY_API_KEY=tvly-...
BRAVE_SEARCH_API_KEY=BSA-...

# Crypto
COINGECKO_API_KEY=...    # Optional — public API works without key (rate limited)

# GitHub
GITHUB_TOKEN=ghp_...

# RSS feeds (comma-separated URLs)
RSS_SOURCES=https://feeds.bbci.co.uk/news/rss.xml,https://coindesk.com/arc/outboundfeeds/rss/

# X / Twitter
X_BEARER_TOKEN=...
X_DEFAULT_QUERY=starknet OR STRK crypto prediction

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNELS=@starknet_news,@cryptopredictions

# Starknet
STARKNET_RPC_URL=https://rpc.starknet-testnet.lava.build
```

## Graceful Degradation

All fetchers catch errors and return empty `data: []` with a descriptive `summary`:

```
"No Tavily data (TAVILY_API_KEY not configured)."
"No web data (BRAVE_SEARCH_API_KEY not configured)."
"No coingecko data (request failed)."
```

This means `gatherResearch()` always resolves — never throws. Use `result.data.length === 0` to detect missing data.
