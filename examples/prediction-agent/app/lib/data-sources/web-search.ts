/**
 * Web Search Data Source — Fetches general web results via Brave Search API.
 * Requires BRAVE_SEARCH_API_KEY.
 */

import type { DataPoint, DataSourceResult } from "./index";
import { fetchNewsData } from "./news-search";
import { fetchTavilySearch } from "./tavily";

const BRAVE_WEB_API = "https://api.search.brave.com/res/v1/web/search";

export async function fetchWebSearch(question: string): Promise<DataSourceResult> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  const query = question.trim();

  if (!apiKey) {
    // Fallback chain: Tavily (if configured) -> News RSS fallback.
    if (process.env.TAVILY_API_KEY) {
      const tavily = await fetchTavilySearch(query);
      return {
        ...tavily,
        source: "web",
        summary: tavily.data.length
          ? `Web fallback via Tavily (${tavily.data.length} results).`
          : tavily.summary,
      };
    }
    const news = await fetchNewsData(query);
    return {
      source: "web",
      query,
      timestamp: Date.now(),
      data: news.data,
      summary: `Web fallback via news index (${news.data.length} results).`,
    };
  }

  try {
    const url = `${BRAVE_WEB_API}?q=${encodeURIComponent(query)}&count=5&freshness=pw`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`Brave API ${response.status}`);

    const result = await response.json();
    const items = result.web?.results ?? [];

    const data: DataPoint[] = items.slice(0, 5).map((item: any) => ({
      label: item.title ?? "Result",
      value: item.description?.slice(0, 120) ?? "No description",
      url: item.url,
    }));

    return {
      source: "web",
      query,
      timestamp: Date.now(),
      data,
      summary: `Found ${items.length} web results for "${query}".`,
    };
  } catch (err: any) {
    if (process.env.TAVILY_API_KEY) {
      const tavily = await fetchTavilySearch(query);
      return {
        ...tavily,
        source: "web",
        summary: tavily.data.length
          ? `Brave failed, fallback via Tavily (${tavily.data.length} results).`
          : `No web data (${err?.message ?? "request failed"}).`,
      };
    }
    const news = await fetchNewsData(query);
    return {
      source: "web",
      query,
      timestamp: Date.now(),
      data: news.data,
      summary: news.data.length
        ? `Brave failed, fallback via news index (${news.data.length} results).`
        : `No web data (${err?.message ?? "request failed"}).`,
    };
  }
}
