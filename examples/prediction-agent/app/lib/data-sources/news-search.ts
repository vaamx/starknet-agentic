/**
 * News Search Data Source — Fetches news headlines related to the question.
 *
 * Uses Brave Search API when BRAVE_SEARCH_API_KEY is set.
 * Falls back to Google News RSS when the API key is unavailable or Brave fails.
 */

import type { DataSourceResult, DataPoint } from "./index";

const BRAVE_API = "https://api.search.brave.com/res/v1/news/search";
const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRssItems(xml: string): DataPoint[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  const points: DataPoint[] = [];

  for (const item of items.slice(0, 5)) {
    const titleMatch = item.match(/<title>(<!\[CDATA\[)?([\s\S]*?)(\]\]>)?<\/title>/i);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);

    const title = decodeHtmlEntities((titleMatch?.[2] ?? "Untitled").trim());
    const url = decodeHtmlEntities((linkMatch?.[1] ?? "").trim());
    const source = decodeHtmlEntities((sourceMatch?.[1] ?? "news").trim());
    if (!title) continue;

    points.push({
      label: source || "News",
      value: title,
      url,
    });
  }

  return points;
}

async function fetchGoogleNewsFallback(
  keywords: string,
  reason: string
): Promise<DataSourceResult> {
  try {
    const url = `${GOOGLE_NEWS_RSS}?q=${encodeURIComponent(
      keywords
    )}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, {
      headers: { Accept: "application/rss+xml,application/xml,text/xml" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Google News RSS ${response.status}`);

    const xml = await response.text();
    const data = parseRssItems(xml);
    return {
      source: "news",
      query: keywords,
      timestamp: Date.now(),
      data,
      summary:
        data.length > 0
          ? `Top headlines from Google News RSS (${reason}).`
          : `No fallback headlines available (${reason}).`,
    };
  } catch (err: any) {
    return {
      source: "news",
      query: keywords,
      timestamp: Date.now(),
      data: [],
      summary: `No news data (${err?.message ?? reason}).`,
    };
  }
}

export async function fetchNewsData(
  question: string
): Promise<DataSourceResult> {
  const keywords = extractNewsKeywords(question);
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    return fetchGoogleNewsFallback(
      keywords,
      "BRAVE_SEARCH_API_KEY not configured"
    );
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
    return fetchGoogleNewsFallback(
      keywords,
      `Brave failed (${err?.message ?? "request failed"})`
    );
  }
  return fetchGoogleNewsFallback(keywords, "Brave returned no matches");
}

function extractNewsKeywords(question: string): string {
  return question
    .replace(/[?!.,"']/g, "")
    .replace(/^will\s+/i, "")
    .replace(/\b(by|before|after|this|next)\s+(month|year|quarter|week)\b/gi, "")
    .trim();
}
