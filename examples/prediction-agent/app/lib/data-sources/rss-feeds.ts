/**
 * RSS Feeds Data Source — Fetches headlines from configured feeds.
 * Provide RSS_SOURCES env (comma-separated URLs).
 */

import type { DataPoint, DataSourceResult } from "./index";
import { config } from "../config";

function parseItems(xml: string): Array<{ title: string; link: string }> {
  const items: Array<{ title: string; link: string }> = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  for (const item of matches) {
    const titleMatch = item.match(/<title>(<!\[CDATA\[)?([\s\S]*?)(\]\]>)?<\/title>/i);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
    const title = titleMatch ? titleMatch[2].trim() : "Untitled";
    const link = linkMatch ? linkMatch[1].trim() : "";
    if (title) {
      items.push({ title, link });
    }
  }

  return items;
}

export async function fetchRssFeeds(question: string): Promise<DataSourceResult> {
  const sources = (config.RSS_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (sources.length === 0) {
    return {
      source: "rss",
      query: question,
      timestamp: Date.now(),
      data: [],
      summary: "No RSS sources configured (RSS_SOURCES missing).",
    };
  }

  try {
    const fetches = await Promise.allSettled(
      sources.map((url) =>
        fetch(url, { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.text() : ""))
          .then((xml) => ({ url, xml }))
      )
    );

    const data: DataPoint[] = [];

    for (const result of fetches) {
      if (result.status !== "fulfilled") continue;
      const { url, xml } = result.value;
      if (!xml) continue;
      const items = parseItems(xml).slice(0, 3);
      const host = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return "RSS";
        }
      })();

      for (const item of items) {
        data.push({
          label: host,
          value: item.title,
          url: item.link || url,
        });
      }
    }

    return {
      source: "rss",
      query: question,
      timestamp: Date.now(),
      data: data.slice(0, 5),
      summary: `Pulled ${data.length} RSS headlines from ${sources.length} feeds.`,
    };
  } catch (err: any) {
    return {
      source: "rss",
      query: question,
      timestamp: Date.now(),
      data: [],
      summary: `No RSS data (${err?.message ?? "request failed"}).`,
    };
  }
}
