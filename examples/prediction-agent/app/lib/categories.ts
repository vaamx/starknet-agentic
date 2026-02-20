/**
 * Simple regex-based market categorizer.
 */

export type MarketCategory = "all" | "sports" | "crypto" | "politics" | "tech" | "other";

const SPORTS_REGEX =
  /super bowl|nfl|seahawks|patriots|touchdown|quarterback|mvp|halftime|spread|overtime|rushing|first score|defensive|nba|mlb|world cup|champions league|boxing|ufc|tennis|formula 1|olympics/i;

const CRYPTO_REGEX =
  /bitcoin|btc|ethereum|eth|starknet|strk|solana|sol|crypto|token|defi|nft|blockchain|tps|gas fee|layer\s?2|zk|rollup/i;

const POLITICS_REGEX =
  /president|election|congress|senate|vote|policy|regulation|government|fed|tariff|sanction|legislation|supreme court/i;

const TECH_REGEX =
  /ai\b|artificial intelligence|gpt|llm|openai|google|apple|microsoft|semiconductor|chip|quantum|robot|self.?driving|tesla|spacex|launch/i;

export function categorizeMarket(question: string): MarketCategory {
  if (SPORTS_REGEX.test(question)) return "sports";
  if (CRYPTO_REGEX.test(question)) return "crypto";
  if (POLITICS_REGEX.test(question)) return "politics";
  if (TECH_REGEX.test(question)) return "tech";
  return "other";
}

export function getCategoryCounts(
  markets: { question: string }[]
): Record<MarketCategory, number> {
  const counts: Record<MarketCategory, number> = {
    all: markets.length,
    sports: 0,
    crypto: 0,
    politics: 0,
    tech: 0,
    other: 0,
  };
  for (const m of markets) {
    counts[categorizeMarket(m.question)]++;
  }
  return counts;
}
