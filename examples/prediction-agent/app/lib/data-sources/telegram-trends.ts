/**
 * Telegram Data Source — Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNELS.
 */

import type { DataPoint, DataSourceResult } from "./index";
import { config } from "../config";

function parseChannels(): string[] {
  return (config.TELEGRAM_CHANNELS ?? "")
    .split(",")
    .map((c) => c.trim().replace(/^@/, ""))
    .filter(Boolean);
}

export async function fetchTelegramTrends(question: string): Promise<DataSourceResult> {
  const token = config.TELEGRAM_BOT_TOKEN;
  const channels = parseChannels();

  if (!token || channels.length === 0) {
    return {
      source: "telegram",
      query: question,
      timestamp: Date.now(),
      data: [],
      summary: "No Telegram data (TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNELS missing).",
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?limit=50`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Telegram API ${response.status}`);

    const payload = await response.json();
    const updates = payload.result ?? [];

    const data: DataPoint[] = [];

    for (const update of updates) {
      const post = update.channel_post;
      if (!post?.chat?.username) continue;
      const username = String(post.chat.username).replace(/^@/, "");
      if (!channels.includes(username)) continue;

      const text = post.text ?? post.caption ?? "";
      const messageId = post.message_id;
      if (!text) continue;

      data.push({
        label: `@${username}`,
        value: String(text).slice(0, 120),
        url: `https://t.me/${username}/${messageId}`,
      });

      if (data.length >= 5) break;
    }

    return {
      source: "telegram",
      query: question,
      timestamp: Date.now(),
      data,
      summary: data.length > 0 ? `Latest posts from ${channels.join(", ")}.` : "No recent Telegram posts found.",
    };
  } catch (err: any) {
    return {
      source: "telegram",
      query: question,
      timestamp: Date.now(),
      data: [],
      summary: `No Telegram data (${err?.message ?? "request failed"}).`,
    };
  }
}
