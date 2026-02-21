/**
 * Tavily Search Data Source — AI-synthesized web search for agentic tool-use.
 *
 * Tavily returns a synthesized answer + ranked snippets (low token count).
 * Ideal for tool-use loops where Claude needs concise, parseable results.
 *
 * Requires TAVILY_API_KEY. Returns empty results gracefully if absent.
 */

import type { DataPoint, DataSourceResult } from "./index";

const TAVILY_API = "https://api.tavily.com/search";

export async function fetchTavilySearch(question: string): Promise<DataSourceResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  const query = question.trim();

  // Guard: empty query wastes metered API quota and returns garbage results.
  if (!query) {
    return {
      source: "tavily",
      query: "",
      timestamp: Date.now(),
      data: [],
      summary: "No Tavily data (empty query).",
    };
  }

  if (!apiKey) {
    return {
      source: "tavily",
      query,
      timestamp: Date.now(),
      data: [],
      summary: "No Tavily data (TAVILY_API_KEY not configured).",
    };
  }

  try {
    const response = await fetch(TAVILY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        include_images: false, // never used; omitting reduces response payload
        max_results: 5,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      // Tavily returns JSON error bodies: { "detail": "Invalid API key" } for 401,
      // { "detail": "Rate limit exceeded" } for 429, etc.
      // Extract the detail so the caller gets actionable information rather than just a status code.
      let detail = "";
      try {
        const errBody = await response.json() as any;
        detail = errBody?.detail ?? errBody?.message ?? errBody?.error ?? "";
      } catch {
        // Response body was not JSON — status code alone is all we have.
      }
      throw new Error(`Tavily API ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const result = await response.json();
    const items = result.results ?? [];
    const answer = result.answer ?? "";

    const data: DataPoint[] = items.slice(0, 5).map((item: any) => ({
      label: item.title ?? "Result",
      value: item.content?.slice(0, 150) ?? "No content",
      url: item.url,
      confidence: item.score,
    }));

    // The synthesized answer is Tavily's key value over raw web search —
    // it's an AI-generated summary of all results. 400 chars preserves enough
    // for Claude to use it as direct evidence without excessive token cost.
    const summary = answer
      ? `Tavily answer: ${answer.slice(0, 400)}`
      : `Found ${items.length} results for "${query}".`;

    return {
      source: "tavily",
      query,
      timestamp: Date.now(),
      data,
      summary,
    };
  } catch (err: any) {
    return {
      source: "tavily",
      query,
      timestamp: Date.now(),
      data: [],
      summary: `No Tavily data (${err?.message ?? "request failed"}).`,
    };
  }
}
