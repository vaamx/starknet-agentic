/**
 * Crypto Prices Data Source — Fetches price data from CoinGecko.
 *
 * Uses the free CoinGecko API for current prices and trends.
 * Returns empty results when the API is unavailable.
 */

import type { DataSourceResult, DataPoint } from "./index";

const COINGECKO_API = "https://api.coingecko.com/api/v3";

const CRYPTO_ALIASES: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  btc: "bitcoin",
  bitcoin: "bitcoin",
  strk: "starknet",
  starknet: "starknet",
  sol: "solana",
  solana: "solana",
  matic: "polygon-ecosystem-token",
  polygon: "polygon-ecosystem-token",
  avax: "avalanche-2",
  avalanche: "avalanche-2",
  bnb: "binancecoin",
  ada: "cardano",
  dot: "polkadot",
  link: "chainlink",
  uni: "uniswap",
  aave: "aave",
  usdc: "usd-coin",
  usdt: "tether",
};

/**
 * Detect crypto mentions in question and fetch their prices.
 */
export async function fetchCryptoPrices(
  question: string
): Promise<DataSourceResult> {
  const tokens = detectCryptoTokens(question);

  if (tokens.length === 0) {
    // Default to major cryptos for market context
    tokens.push("ethereum", "bitcoin", "starknet");
  }

  try {
    const ids = tokens.join(",");
    const url = `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`CoinGecko API ${response.status}`);

    const prices = await response.json();
    const data: DataPoint[] = [];

    for (const [id, info] of Object.entries(prices) as [string, any][]) {
      const change24h = info.usd_24h_change;
      const changeStr =
        change24h !== undefined
          ? ` (${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%)`
          : "";
      data.push({
        label: `${id.charAt(0).toUpperCase() + id.slice(1)} Price`,
        value: `$${formatPrice(info.usd)}${changeStr}`,
        confidence: change24h !== undefined ? Math.abs(change24h) / 100 : undefined,
      });
      if (info.usd_market_cap) {
        data.push({
          label: `${id.charAt(0).toUpperCase() + id.slice(1)} Market Cap`,
          value: `$${formatLargeNumber(info.usd_market_cap)}`,
        });
      }
    }

    const tokenNames = tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
    const summary = `Live prices for ${tokenNames.join(", ")}. ${data.length} data points from CoinGecko.`;

    return {
      source: "coingecko",
      query: tokens.join(", "),
      timestamp: Date.now(),
      data,
      summary,
    };
  } catch (err: any) {
    return {
      source: "coingecko",
      query: tokens.join(", "),
      timestamp: Date.now(),
      data: [],
      summary: `No CoinGecko data available (${err?.message ?? "request failed"}).`,
    };
  }
}

function detectCryptoTokens(question: string): string[] {
  const words = question.toLowerCase().split(/[\s,;:!?.()]+/);
  const found = new Set<string>();

  for (const word of words) {
    const id = CRYPTO_ALIASES[word];
    if (id) found.add(id);
  }

  // Also check for $ patterns like "$5,000" which imply price targets
  const priceMatch = question.match(/\$[\d,]+/g);
  if (priceMatch && found.size === 0) {
    // If there's a price target but no specific token detected, check for common patterns
    if (/eth/i.test(question)) found.add("ethereum");
    if (/btc|bitcoin/i.test(question)) found.add("bitcoin");
    if (/strk|starknet/i.test(question)) found.add("starknet");
  }

  return Array.from(found);
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString("en-US");
}
