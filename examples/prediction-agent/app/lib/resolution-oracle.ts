/**
 * Resolution Oracle — AI-driven market resolution.
 *
 * Three resolution strategies by market category:
 * - Sports: ESPN score data + Claude YES/NO determination
 * - Crypto: Price threshold parsing + CoinGecko comparison
 * - General: Tavily search + Claude determination
 *
 * All strategies require confidence >= threshold before executing on-chain.
 * Returns null if evidence is insufficient — never guesses.
 */

import Anthropic from "@anthropic-ai/sdk";
import { categorizeMarket } from "./categories";
import { fetchEspnScores } from "./data-sources/espn-live";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { fetchTavilySearch } from "./data-sources/tavily";
import { logThoughtOnChain } from "./huginn-executor";
import { getActiveAccount, isAgentConfigured } from "./starknet-executor";
import { buildResolveCalls, buildFinalizeCalls } from "./contracts";
import { isSuperBowlMarket } from "./market-reader";

export interface ResolutionResult {
  status: "resolved" | "insufficient_evidence" | "error";
  outcome?: 0 | 1;
  evidence?: string;
  confidence?: number;
  resolveTxHash?: string;
  finalizeTxHash?: string;
  huginnTxHash?: string;
  huginnThoughtHash?: string;
  error?: string;
}

interface OracleDecision {
  outcome: 0 | 1;
  confidence: number;
  reasoning: string;
}

const MIN_SPORTS_CONFIDENCE = 0.85;
const MIN_GENERAL_CONFIDENCE = 0.90;
const MIN_SPORTS_SEARCH_CONFIDENCE = 0.80;
type EspnResult = Awaited<ReturnType<typeof fetchEspnScores>>;

interface TeamScore {
  name: string;
  score: number;
}

function normalizeResolutionQuestion(marketId: number, question: string): string {
  const trimmed = question.trim();
  let normalized = trimmed
    .replace(/\bSB\b/gi, "Super Bowl")
    .replace(/\bTDs?\b/gi, "touchdowns")
    .replace(/\b1H\b/gi, "first half")
    .replace(/\b2min\b/gi, "two minutes");

  if (
    isSuperBowlMarket(marketId) &&
    !/super bowl|sb\s*[a-z0-9]+/i.test(normalized)
  ) {
    normalized = `${normalized} in Super Bowl LX`;
  }

  return normalized;
}

function parseTeamScores(espnResult: EspnResult): TeamScore[] {
  return (espnResult.data ?? [])
    .map((point) => {
      const nameMatch = String(point.label).match(/^(.*?)\s+\((Home|Away)\)$/i);
      const scoreMatch = String(point.value).match(/Score:\s*(\d+)/i);
      if (!nameMatch || !scoreMatch) return null;
      return {
        name: nameMatch[1].trim(),
        score: Number(scoreMatch[1]),
      };
    })
    .filter((entry): entry is TeamScore => !!entry && Number.isFinite(entry.score));
}

function deriveSportsOutcomeFromEspn(
  question: string,
  espnResult: EspnResult
): OracleDecision | null {
  const q = question.toLowerCase();
  const teamScores = parseTeamScores(espnResult);

  // Pattern: "<team> win ..."
  const winMatch = question.match(/^(.+?)\s+win\b/i);
  if (winMatch && teamScores.length >= 2) {
    const teamToken = winMatch[1].trim().toLowerCase();
    const target = teamScores.find((team) =>
      team.name.toLowerCase().includes(teamToken)
    );
    if (target) {
      const opponentBest = Math.max(
        ...teamScores
          .filter((team) => team.name !== target.name)
          .map((team) => team.score)
      );
      const outcome: 0 | 1 = target.score > opponentBest ? 1 : 0;
      return {
        outcome,
        confidence: 0.99,
        reasoning: `Resolved from ESPN final score: ${target.name} ${target.score} vs opponent ${opponentBest}.`,
      };
    }
    const participants = teamScores.map((team) => team.name).join(" vs ");
    return {
      outcome: 0,
      confidence: 0.97,
      reasoning: `Resolved NO: team "${winMatch[1].trim()}" not present in final matchup (${participants}).`,
    };
  }

  // Pattern: total score over/under X
  const totalMatch = question.match(/total score\s+(over|under)\s+(\d+(?:\.\d+)?)/i);
  if (totalMatch && teamScores.length >= 2) {
    const total = teamScores.reduce((sum, team) => sum + team.score, 0);
    const threshold = parseFloat(totalMatch[2]);
    const isOver = totalMatch[1].toLowerCase() === "over";
    const outcome: 0 | 1 = isOver ? (total > threshold ? 1 : 0) : total < threshold ? 1 : 0;
    return {
      outcome,
      confidence: 0.98,
      reasoning: `Resolved from ESPN final total ${total} vs threshold ${threshold} (${isOver ? "over" : "under"}).`,
    };
  }

  // Pattern: 100+ rushing yards player
  if (/100\+\s*rush|rush(?:ing)?\s+yards?\s+player/i.test(q)) {
    const rushingLeader = espnResult.data.find((d) =>
      String(d.label).toLowerCase().includes("rushingyards leader")
    );
    const yardsMatch = rushingLeader
      ? String(rushingLeader.value).match(/(\d+)\s*YDS/i)
      : null;
    if (yardsMatch) {
      const yards = Number(yardsMatch[1]);
      const outcome: 0 | 1 = yards >= 100 ? 1 : 0;
      return {
        outcome,
        confidence: 0.94,
        reasoning: `Resolved from ESPN rushing leader stat: ${yards} yards.`,
      };
    }
  }

  // Pattern: overtime yes/no
  if (/overtime/i.test(q)) {
    const summary = `${espnResult.summary} ${espnResult.data
      .map((d) => `${d.label}: ${d.value}`)
      .join(" ")}`.toLowerCase();
    const wentOvertime = /\bot\b|overtime/.test(summary);
    const outcome: 0 | 1 = wentOvertime ? 1 : 0;
    return {
      outcome,
      confidence: 0.9,
      reasoning: `Resolved from ESPN status summary (${wentOvertime ? "overtime detected" : "no overtime detected"}).`,
    };
  }

  return null;
}

/** Parse a price threshold from a question string. e.g. "above $0.15" → 0.15 */
function parsePriceThreshold(question: string): { threshold: number; above: boolean } | null {
  const match = question.match(/(?:above|exceed|over|surpass|below|under|drop below)\s+\$?([\d,]+(?:\.\d+)?)/i);
  if (!match) return null;
  const threshold = parseFloat(match[1].replace(/,/g, ""));
  const above = /above|exceed|over|surpass/i.test(match[0]);
  return { threshold, above };
}

/** Ask Claude to determine YES/NO from evidence text. */
async function askClaudeForOutcome(
  question: string,
  evidence: string,
  client: Anthropic
): Promise<{ outcome: 0 | 1; confidence: number } | null> {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: `Based on this evidence, did the following prediction market question resolve YES or NO?

Question: "${question}"

Evidence:
${evidence}

Respond ONLY in this exact format (no other text):
OUTCOME:YES or OUTCOME:NO
CONFIDENCE:0.0-1.0

If you cannot determine the outcome from the evidence, respond:
OUTCOME:UNKNOWN
CONFIDENCE:0.0`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    const outcomeMatch = text.match(/OUTCOME:(YES|NO|UNKNOWN)/i);
    const confidenceMatch = text.match(/CONFIDENCE:([\d.]+)/i);

    if (!outcomeMatch || !confidenceMatch) return null;
    if (outcomeMatch[1].toUpperCase() === "UNKNOWN") return null;

    const outcome: 0 | 1 = outcomeMatch[1].toUpperCase() === "YES" ? 1 : 0;
    const confidence = parseFloat(confidenceMatch[1]);

    return { outcome, confidence };
  } catch {
    return null;
  }
}

/** Sports resolution strategy: ESPN data + Claude. */
async function resolveSports(
  question: string,
  client: Anthropic
): Promise<OracleDecision | null> {
  const espnResult = await fetchEspnScores(question);
  if (espnResult.data.length === 0) return null;

  // Spec: "Return null if game not final."
  // fetchEspnScores sets summary to "FINAL: ..." and the "Game Status" data point
  // to "FINAL" only when gameState === "STATUS_FINAL". In-progress games start
  // with "LIVE:" and scheduled games with "Upcoming:". Resolving on partial or
  // pre-game data produces premature, unreliable outcomes.
  const gameIsFinal =
    espnResult.summary.startsWith("FINAL:") ||
    espnResult.data.some((d) => d.label === "Game Status" && d.value === "FINAL");
  if (!gameIsFinal) return null;

  const deterministic = deriveSportsOutcomeFromEspn(question, espnResult);
  if (deterministic) return deterministic;

  const evidence = [
    espnResult.summary,
    ...espnResult.data.map((d) => `${d.label}: ${d.value}`),
  ].join("\n");

  const decision = await askClaudeForOutcome(question, evidence, client);
  if (!decision || decision.confidence < MIN_SPORTS_CONFIDENCE) return null;

  return {
    outcome: decision.outcome,
    confidence: decision.confidence,
    reasoning: `Sports resolution via ESPN data:\n${evidence}\n\nClaude decision: ${decision.outcome === 1 ? "YES" : "NO"} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`,
  };
}

/** Crypto resolution strategy: price threshold parsing + CoinGecko. */
async function resolveCrypto(question: string): Promise<OracleDecision | null> {
  const parsed = parsePriceThreshold(question);
  if (!parsed) return null;

  // Try to extract token from question
  const tokenMatch = question.match(/\b(bitcoin|btc|ethereum|eth|starknet|strk|solana|sol)\b/i);
  if (!tokenMatch) return null;

  const tokenMap: Record<string, string> = {
    bitcoin: "bitcoin", btc: "bitcoin",
    ethereum: "ethereum", eth: "ethereum",
    starknet: "starknet", strk: "starknet",
    solana: "solana", sol: "solana",
  };
  const tokenId = tokenMap[tokenMatch[1].toLowerCase()];
  if (!tokenId) return null;

  const priceResult = await fetchCryptoPrices(tokenId);
  // crypto-prices.ts labels are "Bitcoin Price", "Ethereum Price", etc. — never "usd".
  // Use the first data point directly (the price entry for the requested token).
  const pricePoint = priceResult.data[0];

  if (!pricePoint) return null;

  const currentPrice = parseFloat(String(pricePoint.value).replace(/[^0-9.]/g, ""));
  if (isNaN(currentPrice)) return null;

  const outcome: 0 | 1 = parsed.above
    ? currentPrice > parsed.threshold ? 1 : 0
    : currentPrice < parsed.threshold ? 1 : 0;

  const reasoning = `Crypto resolution: ${tokenId} current price $${currentPrice.toFixed(4)}, threshold $${parsed.threshold.toFixed(4)}, condition "${parsed.above ? "above" : "below"}" → ${outcome === 1 ? "YES" : "NO"}`;

  return { outcome, confidence: 0.95, reasoning };
}

/** General resolution strategy: Tavily search + Claude. */
async function resolveGeneral(
  question: string,
  client: Anthropic,
  minConfidence = MIN_GENERAL_CONFIDENCE
): Promise<OracleDecision | null> {
  const searchQuery = `${question} result OR outcome OR confirmed OR resolved`;
  const tavilyResult = await fetchTavilySearch(searchQuery);

  // Tavily summaries start with "Tavily answer: " when a synthesized answer is present.
  // Using startsWith is more precise than includes("answer"), which could match
  // error messages or question text that happen to contain the word "answer".
  if (tavilyResult.data.length === 0 && !tavilyResult.summary.startsWith("Tavily answer:")) {
    return null;
  }

  const evidence = [
    tavilyResult.summary,
    ...tavilyResult.data.map((d) => `${d.label}: ${d.value}`),
  ].join("\n");

  const decision = await askClaudeForOutcome(question, evidence, client);
  if (!decision || decision.confidence < minConfidence) return null;

  return {
    outcome: decision.outcome,
    confidence: decision.confidence,
    reasoning: `General resolution via web search:\n${evidence}\n\nClaude decision: ${decision.outcome === 1 ? "YES" : "NO"} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`,
  };
}

/**
 * Try to resolve a market using the appropriate oracle strategy.
 * Returns ResolutionResult — never throws.
 */
export async function tryResolveMarket(
  marketId: number,
  marketAddress: string,
  question: string
): Promise<ResolutionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: "error", error: "Anthropic API key not configured" };
  }

  const client = new Anthropic({ apiKey });

  // 1. Select and run strategy
  let decision: OracleDecision | null = null;
  const normalizedQuestion = normalizeResolutionQuestion(marketId, question);
  try {
    const category = categorizeMarket(normalizedQuestion);

    if (category === "sports") {
      decision = await resolveSports(normalizedQuestion, client);
      if (!decision) {
        decision = await resolveGeneral(
          `${normalizedQuestion} final score winner stats`,
          client,
          MIN_SPORTS_SEARCH_CONFIDENCE
        );
      }
    } else if (category === "crypto") {
      decision =
        (await resolveCrypto(normalizedQuestion)) ??
        (await resolveGeneral(normalizedQuestion, client));
    } else {
      decision = await resolveGeneral(normalizedQuestion, client);
    }
  } catch (err: any) {
    return { status: "error", error: `Oracle strategy failed: ${err?.message}` };
  }

  if (!decision) {
    return { status: "insufficient_evidence" };
  }

  // 2. Log reasoning to Huginn (non-blocking)
  let huginnTxHash: string | undefined;
  let huginnThoughtHash: string | undefined;
  try {
    const huginnResult = await logThoughtOnChain(decision.reasoning);
    if (huginnResult.status === "success") {
      huginnTxHash = huginnResult.txHash;
      huginnThoughtHash = huginnResult.thoughtHash;
    }
  } catch {
    // Non-blocking
  }

  // 3. Execute on-chain if agent is configured
  if (!isAgentConfigured()) {
    return {
      status: "resolved",
      outcome: decision.outcome,
      evidence: decision.reasoning,
      confidence: decision.confidence,
      huginnTxHash,
      huginnThoughtHash,
      error: "Agent account not configured — on-chain resolution skipped",
    };
  }

  const account = getActiveAccount();
  if (!account) {
    return {
      status: "resolved",
      outcome: decision.outcome,
      evidence: decision.reasoning,
      confidence: decision.confidence,
      huginnTxHash,
      huginnThoughtHash,
      error: "Could not get active account",
    };
  }

  let resolveTxHash: string | undefined;
  let finalizeTxHash: string | undefined;

  const resolveCalls = buildResolveCalls(marketAddress, decision.outcome);
  const finalizeCalls = buildFinalizeCalls(marketId, decision.outcome);

  try {
    // Attempt resolve + finalize as a single multicall — one gas cost, fully atomic.
    // If the finalize call fails (wrong AccuracyTracker, already finalized, etc.),
    // the whole multicall reverts and we fall back to resolve-only below.
    const combinedTx = await account.execute([...resolveCalls, ...finalizeCalls]);
    resolveTxHash = combinedTx.transaction_hash;
    finalizeTxHash = combinedTx.transaction_hash; // same tx
  } catch (combinedErr: any) {
    // Multicall failed — retry with resolve-only so the market is at least settled.
    // Finalize failure (AccuracyTracker not tracking this market, etc.) is non-fatal.
    console.warn(
      "[resolution-oracle] Multicall resolve+finalize failed, retrying resolve-only:",
      combinedErr?.message
    );
    try {
      const resolveTx = await account.execute(resolveCalls);
      resolveTxHash = resolveTx.transaction_hash;
    } catch (resolveErr: any) {
      return {
        status: "error",
        outcome: decision.outcome,
        evidence: decision.reasoning,
        confidence: decision.confidence,
        huginnTxHash,
        huginnThoughtHash,
        error: `On-chain resolution failed: ${resolveErr?.message}`,
      };
    }
  }

  return {
    status: "resolved",
    outcome: decision.outcome,
    evidence: decision.reasoning,
    confidence: decision.confidence,
    resolveTxHash,
    finalizeTxHash,
    huginnTxHash,
    huginnThoughtHash,
  };
}
