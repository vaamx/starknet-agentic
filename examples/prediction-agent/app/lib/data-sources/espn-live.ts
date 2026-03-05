/**
 * ESPN Live Scores Data Source — Fetches real-time NFL game data.
 *
 * Uses ESPN's free public API (no API key required).
 * Provides live scores, quarter, clock, team stats, spreads.
 */

import type { DataSourceResult, DataPoint } from "./index";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SPORTS_KEYWORD_REGEX =
  /super bowl|\bsb\b|nfl|seahawks|touchdown|quarterback|halftime|overtime|mvp|rushing|first score|defensive/i;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatDateKey(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(
    date.getUTCDate()
  )}`;
}

function secondSundayOfFebruaryUtc(year: number): Date {
  const first = new Date(Date.UTC(year, 1, 1));
  const firstDay = first.getUTCDay(); // 0 = Sunday
  const firstSundayOffset = (7 - firstDay) % 7;
  const day = 1 + firstSundayOffset + 7;
  return new Date(Date.UTC(year, 1, day));
}

function buildSuperBowlDateCandidates(now: Date): string[] {
  const years = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];
  const keys: string[] = [];
  for (const year of years) {
    const base = secondSundayOfFebruaryUtc(year);
    for (const delta of [-1, 0, 1]) {
      const date = new Date(base);
      date.setUTCDate(base.getUTCDate() + delta);
      keys.push(formatDateKey(date));
    }
  }
  return Array.from(new Set(keys));
}

function getTeamTokens(question: string): string[] {
  const stop = new Set([
    "will",
    "win",
    "over",
    "under",
    "score",
    "total",
    "first",
    "last",
    "half",
    "touchdown",
    "defensive",
    "quarterback",
    "mvp",
    "super",
    "bowl",
    "nfl",
    "sb",
    "lx",
    "is",
    "a",
    "the",
    "in",
    "by",
    "of",
  ]);

  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function isSuperBowlEvent(event: any): boolean {
  const text = `${event?.name ?? ""} ${event?.shortName ?? ""}`.toLowerCase();
  return text.includes("super bowl");
}

function pickRelevantGame(events: any[], question: string): any | null {
  if (!Array.isArray(events) || events.length === 0) return null;

  const teamTokens = getTeamTokens(question);
  const byQuestion = events.find((event) => {
    const text = `${event?.name ?? ""} ${event?.shortName ?? ""}`.toLowerCase();
    if (teamTokens.length === 0) return false;
    return teamTokens.some((token) => text.includes(token));
  });

  const superBowl = events.find((event) => isSuperBowlEvent(event));
  return byQuestion ?? superBowl ?? events[0];
}

async function fetchScoreboardEvents(dateKey?: string): Promise<any[]> {
  const url = dateKey
    ? `${ESPN_SCOREBOARD_URL}?dates=${encodeURIComponent(dateKey)}`
    : ESPN_SCOREBOARD_URL;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN API ${response.status}`);

  const result = await response.json();
  return result.events ?? [];
}

async function findRelevantGame(question: string): Promise<any | null> {
  const events = await fetchScoreboardEvents();
  const primary = pickRelevantGame(events, question);
  if (primary) return primary;

  if (!SPORTS_KEYWORD_REGEX.test(question)) return null;

  const candidates = buildSuperBowlDateCandidates(new Date());
  for (const dateKey of candidates) {
    try {
      const historicalEvents = await fetchScoreboardEvents(dateKey);
      const game = pickRelevantGame(historicalEvents, question);
      if (game) return game;
    } catch {
      // Continue best-effort historical lookups.
    }
  }

  return null;
}

export async function fetchEspnScores(
  question: string
): Promise<DataSourceResult> {
  try {
    const game = await findRelevantGame(question);

    if (!game) {
      return {
        source: "espn",
        query: question,
        timestamp: Date.now(),
        data: [],
        summary: "No live NFL game data available.",
      };
    }

    const competition = game.competitions?.[0];
    const status = game.status;
    const data: DataPoint[] = [];

    // Game status
    const gameState = status?.type?.name ?? "STATUS_UNKNOWN";
    const displayClock = status?.displayClock ?? "";
    const period = status?.period ?? 0;

    data.push({
      label: "Game Status",
      value:
        gameState === "STATUS_IN_PROGRESS"
          ? `LIVE - Q${period} ${displayClock}`
          : gameState === "STATUS_FINAL"
            ? "FINAL"
            : gameState === "STATUS_SCHEDULED"
              ? `Scheduled: ${status?.type?.shortDetail ?? "TBD"}`
              : gameState,
    });

    // Team scores
    if (competition?.competitors) {
      for (const team of competition.competitors) {
        const teamName = team.team?.displayName ?? team.team?.abbreviation ?? "Unknown";
        const score = team.score ?? "0";
        const record = team.records?.[0]?.summary ?? "";
        const homeAway = team.homeAway === "home" ? "(Home)" : "(Away)";

        data.push({
          label: `${teamName} ${homeAway}`,
          value: `Score: ${score}${record ? ` | Record: ${record}` : ""}`,
        });

        // Team stats if available
        if (team.statistics) {
          for (const stat of team.statistics.slice(0, 3)) {
            data.push({
              label: `${team.team?.abbreviation} ${stat.name}`,
              value: stat.displayValue ?? String(stat.value),
            });
          }
        }
      }
    }

    // Odds/spread if available
    if (competition?.odds?.[0]) {
      const odds = competition.odds[0];
      if (odds.details) {
        data.push({
          label: "Spread/Line",
          value: odds.details,
        });
      }
      if (odds.overUnder) {
        data.push({
          label: "Over/Under",
          value: String(odds.overUnder),
        });
      }
    }

    // Situation (possession, yard line, down & distance)
    if (competition?.situation) {
      const sit = competition.situation;
      if (sit.downDistanceText) {
        data.push({
          label: "Current Play",
          value: sit.downDistanceText,
        });
      }
      if (sit.possession) {
        data.push({
          label: "Possession",
          value: sit.possession,
        });
      }
    }

    // Leaders if available
    if (competition?.leaders) {
      for (const category of competition.leaders.slice(0, 2)) {
        const leader = category.leaders?.[0];
        if (leader) {
          data.push({
            label: `${category.name} Leader`,
            value: `${leader.athlete?.displayName ?? "Unknown"}: ${leader.displayValue}`,
          });
        }
      }
    }

    const totalScore = (competition?.competitors ?? []).reduce(
      (sum: number, t: any) => sum + (parseInt(t.score) || 0),
      0
    );

    const summary =
      gameState === "STATUS_IN_PROGRESS"
        ? `LIVE: ${game.shortName ?? game.name} — Q${period} ${displayClock}, Total: ${totalScore}`
        : gameState === "STATUS_FINAL"
          ? `FINAL: ${game.shortName ?? game.name} — Total: ${totalScore}`
          : `Upcoming: ${game.shortName ?? game.name} — ${status?.type?.shortDetail ?? "TBD"}`;

    return {
      source: "espn",
      query: question,
      timestamp: Date.now(),
      data,
      summary,
    };
  } catch (err: any) {
    return {
      source: "espn",
      query: question,
      timestamp: Date.now(),
      data: [],
      summary: `No ESPN data available (${err?.message ?? "request failed"}).`,
    };
  }
}
