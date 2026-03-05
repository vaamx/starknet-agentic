import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverMarkets } from "./market-discovery";
import { fetchPolymarketData } from "./data-sources/polymarket";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { fetchNewsData } from "./data-sources/news-search";
import { fetchRssFeeds } from "./data-sources/rss-feeds";
import { fetchEspnScores } from "./data-sources/espn-live";

vi.mock("./data-sources/polymarket", () => ({
  fetchPolymarketData: vi.fn(),
}));

vi.mock("./data-sources/crypto-prices", () => ({
  fetchCryptoPrices: vi.fn(),
}));

vi.mock("./data-sources/news-search", () => ({
  fetchNewsData: vi.fn(),
}));

vi.mock("./data-sources/rss-feeds", () => ({
  fetchRssFeeds: vi.fn(),
}));

vi.mock("./data-sources/espn-live", () => ({
  fetchEspnScores: vi.fn(),
}));

const now = Date.now();

function emptyResult(source: string) {
  return {
    source,
    query: "q",
    timestamp: now,
    data: [],
    summary: "none",
  };
}

describe("market-discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchNewsData).mockResolvedValue(emptyResult("news"));
    vi.mocked(fetchRssFeeds).mockResolvedValue(emptyResult("rss"));
    vi.mocked(fetchCryptoPrices).mockResolvedValue(emptyResult("coingecko"));
    vi.mocked(fetchEspnScores).mockResolvedValue({
      source: "espn",
      query: "sports",
      timestamp: now,
      summary: "Upcoming game",
      data: [
        { label: "Chiefs (away)", value: "0" },
        { label: "Eagles (home)", value: "0" },
      ],
    });
  });

  it("filters malformed legacy questions before returning suggestions", async () => {
    vi.mocked(fetchPolymarketData).mockResolvedValue({
      source: "polymarket",
      query: "sports",
      timestamp: now,
      summary: "sports",
      data: [
        { label: "Will Joel Embiid win t 30d 8ab6", value: "50%" },
        { label: "Will Joel Embiid win MVP in 2026?", value: "55%" },
      ],
    });

    const markets = await discoverMarkets("sports", 10);
    const questions = markets.map((market) => market.question.toLowerCase());

    expect(questions.some((q) => q.includes("30d") || q.includes("8ab6"))).toBe(false);
    expect(questions.some((q) => q.includes("win t"))).toBe(false);
    expect(questions).toContain("will joel embiid win mvp in 2026?");
  });

  it("enforces a non-crypto floor in auto-discovery mode", async () => {
    vi.mocked(fetchPolymarketData).mockResolvedValue({
      source: "polymarket",
      query: "mixed",
      timestamp: now,
      summary: "mixed",
      data: [
        { label: "Will BTC be above $120k in May 2026?", value: "60%" },
        { label: "Will ETH break $6k in June 2026?", value: "58%" },
        { label: "Will STRK hit $4 in Q3 2026?", value: "48%" },
        { label: "Will Solana exceed $500 this year?", value: "44%" },
        { label: "Will Trump win the next primary debate?", value: "51%" },
        { label: "Will NVIDIA launch a new AI chip this quarter?", value: "64%" },
        { label: "Will the Lakers win the NBA Finals in 2026?", value: "29%" },
      ],
    });

    vi.mocked(fetchCryptoPrices).mockResolvedValue({
      source: "coingecko",
      query: "BTC ETH STRK",
      timestamp: now,
      summary: "prices",
      data: [
        { label: "BTC Price", value: "$95,000" },
        { label: "ETH Price", value: "$3,500" },
      ],
    });

    const limit = 10;
    const markets = await discoverMarkets(undefined, limit);
    const nonCryptoCount = markets.filter((m) => m.category !== "crypto").length;

    expect(markets.length).toBeGreaterThan(0);
    expect(nonCryptoCount).toBeGreaterThanOrEqual(4);
  });
});

