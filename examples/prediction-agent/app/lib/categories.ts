/**
 * Simple regex-based market categorizer.
 */

export type MarketCategory = "all" | "sports" | "crypto" | "politics" | "tech" | "other";

const SPORTS_REGEX =
  /super bowl|nfl|seahawks|patriots|touchdown|quarterback|mvp|halftime|spread|overtime|rush(ing)?|first score|defensive|total score|score last|2min|SB LX|nba|mlb|world cup|champions league|boxing|ufc|tennis|formula 1|olympics|ncaa|premier league|la liga|ncaaf/i;

const CRYPTO_REGEX =
  /bitcoin|btc|ethereum|eth|starknet|strk|solana|sol|crypto|token|defi|nft|blockchain|tps|gas fee|layer\s?2|zk|rollup|airdrop|memecoin|stablecoin|bridge|wallet/i;

const POLITICS_REGEX =
  /president|election|congress|senate|vote|policy|regulation|government|fed|tariff|sanction|legislation|supreme court|parliament|white house|prime minister|ceasefire|ukraine|russia|china|israel|gaza|nato|impeachment|cabinet|campaign|trump|biden|executive order/i;

const TECH_REGEX =
  /ai\b|artificial intelligence|gpt|llm|openai|google|apple|microsoft|semiconductor|chip|quantum|robot|self.?driving|tesla|spacex|launch|nvidia|meta|anthropic|tiktok|youtube|xai|datacenter|robotaxi/i;

const CONTROVERSY_REGEX =
  /will|ban|lawsuit|investigation|impeach|ceasefire|war|rate cut|recession|approval|protest|wins?|loses?|default|hack|exploit|crash|surge/i;

const HIGH_PROFILE_REGEX =
  /trump|biden|musk|elon|powell|putin|zelensky|netanyahu|openai|nvidia|bitcoin|ethereum|super bowl|olympics/i;

export function categorizeMarket(question: string): MarketCategory {
  const normalized = String(question ?? "");
  const isSports = SPORTS_REGEX.test(normalized);
  const isPolitics = POLITICS_REGEX.test(normalized);
  const isTech = TECH_REGEX.test(normalized);
  const isCrypto = CRYPTO_REGEX.test(normalized);

  // Category precedence favors real-world topics over crypto when mixed.
  // Example: "Will Trump mention Bitcoin..." should map to politics.
  if (isSports) return "sports";
  if (isPolitics) return "politics";
  if (isTech && !isCrypto) return "tech";
  if (isCrypto) return "crypto";
  if (isTech) return "tech";
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

/**
 * Lightweight "engagement potential" estimate used for feed sorting and
 * autonomous market focus. Higher means more likely to draw attention/disagreement.
 */
export function estimateEngagementScore(
  question: string,
  resolutionTime?: number
): number {
  const normalized = question.toLowerCase();
  const category = categorizeMarket(question);

  let score = 0.3;
  if (category === "politics") score += 0.25;
  if (category === "sports") score += 0.2;
  if (category === "tech") score += 0.16;
  if (category === "crypto") score += 0.1;
  if (category === "other") score += 0.12;

  if (HIGH_PROFILE_REGEX.test(normalized)) score += 0.16;
  if (CONTROVERSY_REGEX.test(normalized)) score += 0.12;

  if (typeof resolutionTime === "number" && Number.isFinite(resolutionTime)) {
    const secsLeft = resolutionTime - Math.floor(Date.now() / 1000);
    const daysLeft = secsLeft / 86_400;
    if (daysLeft > 0 && daysLeft <= 14) score += 0.12;
    if (daysLeft > 14 && daysLeft <= 45) score += 0.05;
  }

  return Math.max(0, Math.min(1, score));
}
