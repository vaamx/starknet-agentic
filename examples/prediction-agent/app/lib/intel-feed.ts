import { agentLoop, type AgentAction } from "./agent-loop";
import { fetchNewsData } from "./data-sources/news-search";
import { fetchPolymarketData } from "./data-sources/polymarket";
import { fetchSocialTrends } from "./data-sources/social-trends";
import {
  getPersistedLoopActions,
  listPersistedNetworkContributions,
  type PersistedLoopAction,
  type PersistedNetworkContribution,
} from "./state-store";
import {
  getSourceReliabilityProfile,
  listAgentComments,
  type AgentCommentRecord,
  type SourceReliabilityBacktestRow,
} from "./ops-store";

type FeedMode = "live" | "fallback";

export interface IntelChatItem {
  id: string;
  actor: string;
  message: string;
  timestamp: number;
  color: string;
  relevance: number;
  source: "activity" | "network" | "social";
  reliability?: IntelReliabilityBadge;
}

export interface IntelNewsItem {
  id: string;
  source: string;
  headline: string;
  url?: string;
  timestamp: number;
  color: string;
  relevance: number;
  reliability?: IntelReliabilityBadge;
}

export interface IntelReliabilityBadge {
  sourceType: string;
  reliabilityScore: number;
  backtestConfidence: number;
  label: string;
}

export interface IntelFeedPayload {
  generatedAt: number;
  mode: FeedMode;
  chat: IntelChatItem[];
  news: IntelNewsItem[];
}

interface GetIntelFeedParams {
  question: string;
  category?: string;
  marketId?: number;
  limit?: number;
  organizationId?: string;
}

const FEED_TTL_MS = 45_000;
const FEED_CACHE = new Map<
  string,
  {
    expiresAt: number;
    payload: IntelFeedPayload;
  }
>();

const SOURCE_COLORS: Record<string, string> = {
  reuters: "#ff6600",
  ap: "#e51937",
  wsj: "#0274b6",
  bloomberg: "#472a91",
  bbc: "#bb1919",
  polymarket: "#3b82f6",
  social: "#10b981",
  x: "#4ea1ff",
  telegram: "#14b8a6",
};

const AVATAR_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
];

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const tokens = normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3);
  return Array.from(new Set(tokens)).slice(0, 18);
}

function computeRelevance(tokens: string[], text: string): number {
  if (tokens.length === 0) return 0.5;
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  let hitCount = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) hitCount += 1;
  }
  return Math.max(0, Math.min(1, hitCount / tokens.length));
}

function shortText(value: string | undefined, max = 170): string {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function pickColorFromActor(actor: string): string {
  let hash = 0;
  const input = actor.trim().toLowerCase();
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx] ?? AVATAR_COLORS[0];
}

function pickSourceColor(source: string): string {
  const key = normalizeText(source).split(" ")[0] ?? "";
  return SOURCE_COLORS[key] ?? "#64748b";
}

function toCanonicalSourceType(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) return "news";
  if (normalized.includes("reuters")) return "news";
  if (normalized.includes("bloomberg")) return "news";
  if (
    normalized === "ap" ||
    normalized.startsWith("ap ") ||
    normalized.includes(" associated press")
  ) {
    return "news";
  }
  if (normalized.includes("wsj")) return "news";
  if (normalized.includes("bbc")) return "news";
  if (normalized.includes("news")) return "news";
  if (normalized.includes("rss")) return "news";
  if (normalized.includes("web")) return "news";
  if (normalized.includes("tavily")) return "news";
  if (normalized.includes("social")) return "social";
  if (normalized.startsWith("x")) return "social";
  if (normalized.includes("telegram")) return "social";
  if (normalized.includes("polymarket")) return "polymarket";
  if (normalized.includes("coingecko")) return "coingecko";
  if (normalized.includes("onchain")) return "coingecko";
  return normalized.split(" ")[0] ?? "news";
}

function inferCommentFeedSource(sourceType: string): "activity" | "network" | "social" {
  const normalized = toCanonicalSourceType(sourceType);
  if (normalized === "social") return "social";
  if (normalized === "network") return "network";
  return "activity";
}

function pickReliabilityBadge(
  profile: Record<string, SourceReliabilityBacktestRow> | null,
  sourceType: string,
  label: string
): IntelReliabilityBadge | undefined {
  if (!profile) return undefined;
  const canonical = toCanonicalSourceType(sourceType);
  const row = profile[canonical];
  if (!row) return undefined;
  return {
    sourceType: canonical,
    reliabilityScore: Math.max(0, Math.min(1, row.reliabilityScore)),
    backtestConfidence: Math.max(0, Math.min(1, row.confidence)),
    label: label.trim() || canonical.toUpperCase(),
  };
}

function asTimestamp(value: number | undefined): number {
  if (!Number.isFinite(value)) return Date.now();
  const numeric = Number(value);
  // Some producers may emit seconds instead of ms.
  return numeric < 3_000_000_000 ? numeric * 1000 : numeric;
}

function extractSocialActor(label: string): string {
  const lower = label.toLowerCase();
  if (lower.startsWith("x:")) return "X Signals";
  if (lower.startsWith("tg:")) return "Telegram Pulse";
  if (lower.startsWith("proxy:")) return "Web Sentiment";
  return "Social Radar";
}

function toChatFromAction(
  action: PersistedLoopAction | AgentAction,
  questionTokens: string[],
  reliabilityProfile: Record<string, SourceReliabilityBacktestRow> | null
): IntelChatItem | null {
  const actor = shortText(action.agentName, 28) || "Agent";
  const message = shortText(action.detail || action.reasoning, 180);
  if (!message) return null;

  const relevance = computeRelevance(
    questionTokens,
    `${action.question ?? ""} ${message}`
  );

  const sourceType =
    action.type === "research"
      ? "news"
      : action.type === "prediction" || action.type === "bet"
        ? "polymarket"
        : action.type === "debate"
          ? "social"
          : "news";

  return {
    id: `act:${action.id}`,
    actor,
    message,
    timestamp: asTimestamp(action.timestamp),
    color: pickColorFromActor(actor),
    relevance,
    source: "activity",
    reliability: pickReliabilityBadge(
      reliabilityProfile,
      sourceType,
      sourceType.toUpperCase()
    ),
  };
}

function toChatFromContribution(
  entry: PersistedNetworkContribution,
  questionTokens: string[],
  reliabilityProfile: Record<string, SourceReliabilityBacktestRow> | null
): IntelChatItem | null {
  const message = shortText(entry.content || entry.question, 180);
  if (!message) return null;
  const actor = shortText(entry.actorName || "Contributor", 28);
  const relevance = computeRelevance(
    questionTokens,
    `${entry.question ?? ""} ${entry.content ?? ""}`
  );
  const sourceType =
    entry.kind === "research"
      ? "news"
      : entry.kind === "forecast" || entry.kind === "bet"
        ? "polymarket"
        : entry.kind === "debate" || entry.kind === "comment"
          ? "social"
          : "news";

  return {
    id: `net:${entry.id}`,
    actor,
    message,
    timestamp: asTimestamp(entry.createdAt),
    color: pickColorFromActor(actor),
    relevance,
    source: "network",
    reliability: pickReliabilityBadge(
      reliabilityProfile,
      sourceType,
      sourceType.toUpperCase()
    ),
  };
}

function toChatFromComment(
  comment: AgentCommentRecord,
  questionTokens: string[],
  reliabilityProfile: Record<string, SourceReliabilityBacktestRow> | null
): IntelChatItem | null {
  const actor = shortText(comment.actorName, 28) || "Agent";
  const message = shortText(comment.content, 180);
  if (!message) return null;

  const relevance = computeRelevance(
    questionTokens,
    `${actor} ${comment.sourceType} ${message}`
  );

  const profileBadge = pickReliabilityBadge(
    reliabilityProfile,
    comment.sourceType,
    toCanonicalSourceType(comment.sourceType).toUpperCase()
  );
  const reliability: IntelReliabilityBadge | undefined =
    typeof comment.reliabilityScore === "number" ||
    typeof comment.backtestConfidence === "number"
      ? {
          sourceType: toCanonicalSourceType(comment.sourceType),
          reliabilityScore:
            typeof comment.reliabilityScore === "number"
              ? Math.max(0, Math.min(1, comment.reliabilityScore))
              : profileBadge?.reliabilityScore ?? 0.5,
          backtestConfidence:
            typeof comment.backtestConfidence === "number"
              ? Math.max(0, Math.min(1, comment.backtestConfidence))
              : profileBadge?.backtestConfidence ?? 0.35,
          label: profileBadge?.label ?? toCanonicalSourceType(comment.sourceType).toUpperCase(),
        }
      : profileBadge;

  return {
    id: `cmt:${comment.id}`,
    actor,
    message,
    timestamp: asTimestamp(comment.createdAt * 1000),
    color: pickColorFromActor(actor),
    relevance,
    source: inferCommentFeedSource(comment.sourceType),
    reliability,
  };
}

function toNewsHeadline(
  label: string,
  value: string,
  defaultSource: string
): { source: string; headline: string } {
  const cleanLabel = shortText(label, 120);
  const cleanValue = shortText(value, 200);
  const sourceLikely = cleanLabel.length <= 24 && cleanValue.length >= 28;
  if (sourceLikely) {
    return {
      source: cleanLabel || defaultSource,
      headline: cleanValue || cleanLabel || defaultSource,
    };
  }
  return {
    source: defaultSource,
    headline: cleanLabel || cleanValue || defaultSource,
  };
}

function cacheKey(params: GetIntelFeedParams): string {
  return JSON.stringify({
    q: normalizeText(params.question).slice(0, 160),
    c: normalizeText(params.category ?? ""),
    m: params.marketId ?? null,
    l: params.limit ?? 6,
    o: normalizeText(params.organizationId ?? ""),
  });
}

function fallbackChat(params: GetIntelFeedParams): IntelChatItem[] {
  const category = normalizeText(params.category ?? "");
  const base =
    category === "sports"
      ? "Injury + form updates are driving rapid probability shifts."
      : category === "crypto"
        ? "Order flow and on-chain momentum are diverging; monitor volatility."
        : "Narrative pressure is rising; watch for catalyst confirmation.";
  const now = Date.now();
  return [
    {
      id: `fb-chat-${now}-1`,
      actor: "Forecast Core",
      message: shortText(base, 180),
      timestamp: now,
      color: "#10b981",
      relevance: 0.4,
      source: "activity",
    },
    {
      id: `fb-chat-${now}-2`,
      actor: "Risk Engine",
      message: "Confidence is provisional until source diversity improves.",
      timestamp: now - 25_000,
      color: "#3b82f6",
      relevance: 0.35,
      source: "activity",
    },
  ];
}

function fallbackNews(question: string): IntelNewsItem[] {
  const now = Date.now();
  const headline = shortText(question, 140) || "Market catalyst watch";
  return [
    {
      id: `fb-news-${now}-1`,
      source: "Market Desk",
      headline: `No fresh external headlines yet for "${headline}".`,
      timestamp: now,
      color: "#64748b",
      relevance: 0.35,
    },
  ];
}

export async function getIntelFeed(
  params: GetIntelFeedParams
): Promise<IntelFeedPayload> {
  const limit = Math.max(3, Math.min(12, params.limit ?? 6));
  const key = cacheKey(params);
  const cached = FEED_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const questionTokens = tokenize(params.question);
  const organizationId = (params.organizationId ?? "").trim();
  const [persistedActions, networkContributions, persistedComments, reliabilityProfile] =
    await Promise.all([
      getPersistedLoopActions(Math.max(limit * 8, 80)).catch(() => []),
      listPersistedNetworkContributions({
        marketId: params.marketId,
        limit: Math.max(limit * 8, 80),
      }).catch(() => []),
      organizationId
        ? listAgentComments({
            organizationId,
            marketId: params.marketId,
            limit: Math.max(limit * 10, 120),
            order: "desc",
          }).catch(() => [])
        : Promise.resolve([]),
      organizationId
        ? getSourceReliabilityProfile(organizationId).catch(() => null)
        : Promise.resolve(null),
    ]);

  const memoryActions = agentLoop.getActionLog(Math.max(limit * 6, 60));
  const relevantActionTypes = new Set([
    "research",
    "prediction",
    "debate",
    "bet",
    "market_creation",
  ]);

  const chatById = new Map<string, IntelChatItem>();
  for (const action of [...memoryActions, ...persistedActions]) {
    if (!relevantActionTypes.has(action.type)) continue;
    if (params.marketId !== undefined && action.marketId !== params.marketId) continue;
    const mapped = toChatFromAction(action, questionTokens, reliabilityProfile);
    if (!mapped) continue;
    if (mapped.relevance < 0.12 && params.marketId === undefined) continue;
    chatById.set(mapped.id, mapped);
  }

  for (const contribution of networkContributions) {
    if (contribution.kind === "bet") continue;
    const mapped = toChatFromContribution(
      contribution,
      questionTokens,
      reliabilityProfile
    );
    if (!mapped) continue;
    if (mapped.relevance < 0.12 && params.marketId === undefined) continue;
    chatById.set(mapped.id, mapped);
  }

  for (const comment of persistedComments) {
    const mapped = toChatFromComment(comment, questionTokens, reliabilityProfile);
    if (!mapped) continue;
    if (mapped.relevance < 0.1 && params.marketId === undefined) continue;
    chatById.set(mapped.id, mapped);
  }

  const [socialResult, newsResult, polymarketResult] = await Promise.all([
    fetchSocialTrends(params.question).catch(() => null),
    fetchNewsData(params.question).catch(() => null),
    fetchPolymarketData(params.question).catch(() => null),
  ]);

  if (socialResult && socialResult.data.length > 0) {
    for (let i = 0; i < socialResult.data.length; i += 1) {
      const point = socialResult.data[i];
      const actor = extractSocialActor(String(point.label ?? ""));
      const message = shortText(
        typeof point.value === "string"
          ? point.value
          : `${point.label}: ${String(point.value)}`,
        180
      );
      if (!message) continue;
      const relevance = computeRelevance(
        questionTokens,
        `${point.label ?? ""} ${point.value ?? ""}`
      );
      if (relevance < 0.08) continue;
      const id = `soc:${i}:${normalizeText(actor)}:${normalizeText(message).slice(0, 48)}`;
      chatById.set(id, {
        id,
        actor,
        message,
        timestamp: asTimestamp(socialResult.timestamp),
        color: pickSourceColor(actor),
        relevance,
        source: "social",
        reliability: pickReliabilityBadge(
          reliabilityProfile,
          "social",
          "SOCIAL"
        ),
      });
    }
  }

  const newsItems: IntelNewsItem[] = [];
  const pushNews = (
    source: string,
    sourceType: string,
    label: string,
    value: string,
    timestamp: number,
    url?: string
  ) => {
    const parsed = toNewsHeadline(label, value, source);
    if (!parsed.headline) return;
    const relevance = computeRelevance(
      questionTokens,
      `${parsed.source} ${parsed.headline}`
    );
    if (relevance < 0.1) return;
    newsItems.push({
      id: `news:${newsItems.length + 1}:${normalizeText(parsed.source).slice(0, 16)}`,
      source: parsed.source,
      headline: parsed.headline,
      url,
      timestamp: asTimestamp(timestamp),
      color: pickSourceColor(parsed.source),
      relevance,
      reliability: pickReliabilityBadge(
        reliabilityProfile,
        sourceType,
        toCanonicalSourceType(sourceType).toUpperCase()
      ),
    });
  };

  if (newsResult) {
    for (const point of newsResult.data.slice(0, 8)) {
      const label = String(point.label ?? "");
      const value =
        typeof point.value === "string"
          ? point.value
          : String(point.value ?? "");
      pushNews("News", "news", label, value, newsResult.timestamp, point.url);
    }
  }

  if (polymarketResult) {
    for (const point of polymarketResult.data.slice(0, 4)) {
      const label = String(point.label ?? "");
      const value =
        typeof point.value === "string"
          ? point.value
          : String(point.value ?? "");
      pushNews(
        "Polymarket",
        "polymarket",
        label,
        value,
        polymarketResult.timestamp,
        point.url
      );
    }
  }

  const chat = Array.from(chatById.values())
    .sort((a, b) => {
      if (b.relevance === a.relevance) return b.timestamp - a.timestamp;
      return b.relevance - a.relevance;
    })
    .slice(0, limit);

  const dedupedNews = new Map<string, IntelNewsItem>();
  for (const item of newsItems) {
    const keyPart = normalizeText(`${item.source} ${item.headline}`).slice(0, 120);
    if (!keyPart) continue;
    if (!dedupedNews.has(keyPart)) {
      dedupedNews.set(keyPart, item);
    }
  }

  const news = Array.from(dedupedNews.values())
    .sort((a, b) => {
      if (b.relevance === a.relevance) return b.timestamp - a.timestamp;
      return b.relevance - a.relevance;
    })
    .slice(0, limit);

  const payload: IntelFeedPayload = {
    generatedAt: Date.now(),
    mode: chat.length > 0 || news.length > 0 ? "live" : "fallback",
    chat: chat.length > 0 ? chat : fallbackChat(params),
    news: news.length > 0 ? news : fallbackNews(params.question),
  };

  FEED_CACHE.set(key, {
    expiresAt: Date.now() + FEED_TTL_MS,
    payload,
  });

  return payload;
}
