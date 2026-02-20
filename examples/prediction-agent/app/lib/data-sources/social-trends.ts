/**
 * Social Trends Data Source — Aggregates configured social providers.
 */

import type { DataSourceResult, DataPoint } from "./index";
import { fetchXTrends } from "./x-trends";
import { fetchTelegramTrends } from "./telegram-trends";

export async function fetchSocialTrends(
  question: string
): Promise<DataSourceResult> {
  const [xResult, telegramResult] = await Promise.all([
    fetchXTrends(question),
    fetchTelegramTrends(question),
  ]);

  const data: DataPoint[] = [
    ...xResult.data.map((d) => ({ ...d, label: `X: ${d.label}` })),
    ...telegramResult.data.map((d) => ({ ...d, label: `TG: ${d.label}` })),
  ];

  const summaryParts = [];
  if (xResult.data.length > 0) summaryParts.push("X");
  if (telegramResult.data.length > 0) summaryParts.push("Telegram");

  const summary =
    summaryParts.length > 0
      ? `Social signals from ${summaryParts.join(" + ")}.`
      : "No social data provider configured.";

  return {
    source: "social",
    query: question,
    timestamp: Date.now(),
    data,
    summary,
  };
}
