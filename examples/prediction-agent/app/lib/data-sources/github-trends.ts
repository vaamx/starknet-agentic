/**
 * GitHub Trends Data Source — Fetches recent repo activity for a query.
 * Uses GitHub Search API (optional token for higher rate limits).
 */

import type { DataPoint, DataSourceResult } from "./index";
import { config } from "../config";

function buildQuery(question: string): string {
  const tokens = question
    .replace(/[?!."']/g, "")
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2)
    .slice(0, 3);

  if (tokens.length === 0) return "starknet";
  if (tokens.includes("starknet") || tokens.includes("stark")) return "starknet";
  return tokens.join(" ");
}

export async function fetchGithubTrends(question: string): Promise<DataSourceResult> {
  const query = buildQuery(question);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    `${query} pushed:>${since}`
  )}&sort=updated&order=desc&per_page=5`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (config.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }

    const result = await response.json();
    const items = result.items ?? [];

    const data: DataPoint[] = items.slice(0, 5).map((repo: any) => ({
      label: repo.full_name ?? "repo",
      value: repo.description ? repo.description.slice(0, 120) : "No description",
      url: repo.html_url,
    }));

    return {
      source: "github",
      query,
      timestamp: Date.now(),
      data,
      summary: `Top GitHub repos updated recently for "${query}".`,
    };
  } catch (err: any) {
    return {
      source: "github",
      query,
      timestamp: Date.now(),
      data: [],
      summary: `No GitHub data (${err?.message ?? "request failed"}).`,
    };
  }
}
