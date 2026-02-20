/**
 * X (Twitter) Data Source — Requires X_BEARER_TOKEN.
 */

import type { DataPoint, DataSourceResult } from "./index";
import { config } from "../config";

const X_API = "https://api.twitter.com/2/tweets/search/recent";

function buildQuery(question: string): string {
  const cleaned = question.replace(/[?!."']/g, "").trim();
  if (config.X_DEFAULT_QUERY) return config.X_DEFAULT_QUERY;
  if (!cleaned) return "starknet OR bitcoin OR ethereum";
  return cleaned.split(/\s+/).slice(0, 5).join(" ");
}

export async function fetchXTrends(question: string): Promise<DataSourceResult> {
  const token = config.X_BEARER_TOKEN;
  const query = buildQuery(question);

  if (!token) {
    return {
      source: "x",
      query,
      timestamp: Date.now(),
      data: [],
      summary: "No X data (X_BEARER_TOKEN not configured).",
    };
  }

  try {
    const url = `${X_API}?query=${encodeURIComponent(query)}&max_results=5&tweet.fields=created_at,public_metrics`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`X API ${response.status}`);

    const result = await response.json();
    const tweets = result.data ?? [];

    const data: DataPoint[] = tweets.slice(0, 5).map((t: any) => ({
      label: "Tweet",
      value: String(t.text).slice(0, 120),
      url: `https://x.com/i/web/status/${t.id}`,
    }));

    return {
      source: "x",
      query,
      timestamp: Date.now(),
      data,
      summary: `Found ${tweets.length} recent X posts.`,
    };
  } catch (err: any) {
    return {
      source: "x",
      query,
      timestamp: Date.now(),
      data: [],
      summary: `No X data (${err?.message ?? "request failed"}).`,
    };
  }
}
