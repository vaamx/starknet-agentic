/**
 * Social Trends Data Source — Aggregates configured social providers.
 */

import type { DataSourceResult, DataPoint } from "./index";
import { fetchXTrends } from "./x-trends";
import { fetchTelegramTrends } from "./telegram-trends";
import { fetchWebSearch } from "./web-search";

export async function fetchSocialTrends(
  question: string
): Promise<DataSourceResult> {
  const [xResult, telegramResult] = await Promise.all([
    fetchXTrends(question),
    fetchTelegramTrends(question),
  ]);

  let data: DataPoint[] = [
    ...xResult.data.map((d) => ({ ...d, label: `X: ${d.label}` })),
    ...telegramResult.data.map((d) => ({ ...d, label: `TG: ${d.label}` })),
  ];

  const summaryParts = [];
  if (xResult.data.length > 0) summaryParts.push("X");
  if (telegramResult.data.length > 0) summaryParts.push("Telegram");

  let summary =
    summaryParts.length > 0
      ? `Social signals from ${summaryParts.join(" + ")}.`
      : "No direct social APIs configured.";

  if (data.length === 0) {
    const webFallback = await fetchWebSearch(`${question} reactions sentiment`);
    if (webFallback.data.length > 0) {
      data = webFallback.data.map((d) => ({
        ...d,
        label: `Proxy: ${d.label}`,
      }));
      summary = `Social proxy from web/news fallback (${webFallback.data.length} points).`;
    }
  }

  return {
    source: "social",
    query: question,
    timestamp: Date.now(),
    data,
    summary,
  };
}
