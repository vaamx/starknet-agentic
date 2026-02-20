/**
 * Web Search Data Source — Fetches general web results via Brave Search API.
 * Requires BRAVE_SEARCH_API_KEY.
 */

import type { DataPoint, DataSourceResult } from "./index";

const BRAVE_WEB_API = "https://api.search.brave.com/res/v1/web/search";

export async function fetchWebSearch(question: string): Promise<DataSourceResult> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  const query = question.trim();

  if (!apiKey) {
    return {
      source: "web",
      query,
      timestamp: Date.now(),
      data: [],
      summary: "No web data (BRAVE_SEARCH_API_KEY not configured).",
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
    return {
      source: "web",
      query,
      timestamp: Date.now(),
      data: [],
      summary: `No web data (${err?.message ?? "request failed"}).`,
    };
  }
}
