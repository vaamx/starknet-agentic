/**
 * News Search Data Source — Fetches news headlines related to the question.
 *
 * Uses Brave Search API when BRAVE_SEARCH_API_KEY is set.
 * Returns empty results when the API is unavailable.
 */

import type { DataSourceResult, DataPoint } from "./index";

const BRAVE_API = "https://api.search.brave.com/res/v1/news/search";

export async function fetchNewsData(
  question: string
): Promise<DataSourceResult> {
  const keywords = extractNewsKeywords(question);
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    return {
      source: "news",
      query: keywords,
      timestamp: Date.now(),
      data: [],
      summary: "No news data (BRAVE_SEARCH_API_KEY not configured).",
    };
  }

  try {
    const url = `${BRAVE_API}?q=${encodeURIComponent(keywords)}&count=5&freshness=pw`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`Brave API ${response.status}`);

    const result = await response.json();
    const articles = result.results ?? [];

    if (articles.length > 0) {
      const data: DataPoint[] = articles.slice(0, 5).map((a: any) => ({
        label: a.title ?? "Untitled",
        value: a.description?.slice(0, 120) ?? "No description",
        url: a.url,
      }));

      return {
        source: "news",
        query: keywords,
        timestamp: Date.now(),
        data,
        summary: `Found ${articles.length} recent news articles. Top: "${articles[0].title}".`,
      };
    }
  } catch (err: any) {
    return {
      source: "news",
      query: keywords,
      timestamp: Date.now(),
      data: [],
      summary: `No news data (${err?.message ?? "request failed"}).`,
    };
  }
  return {
    source: "news",
    query: keywords,
    timestamp: Date.now(),
    data: [],
    summary: "No news data available.",
  };
}

function extractNewsKeywords(question: string): string {
  return question
    .replace(/[?!.,"']/g, "")
    .replace(/^will\s+/i, "")
    .replace(/\b(by|before|after|this|next)\s+(month|year|quarter|week)\b/gi, "")
    .trim();
}
