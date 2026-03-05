import { NextRequest, NextResponse } from "next/server";
import { getOnChainActivities } from "@/lib/event-indexer";
import { agentLoop } from "@/lib/agent-loop";
import { getMarkets, registerQuestion, resolveMarketQuestion } from "@/lib/market-reader";
import { config } from "@/lib/config";
import {
  getPersistedLoopActions,
  getPersistedMarketSnapshots,
  listPersistedNetworkContributions,
} from "@/lib/state-store";

export const runtime = "nodejs";

function normalizeActivityText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function activitySignature(activity: {
  type: string;
  actor: string;
  marketId?: number;
  question?: string;
  outcome?: string;
  amount?: string;
  probability?: number;
  debateTarget?: string;
  detail?: string;
}): string {
  const probability =
    typeof activity.probability === "number"
      ? activity.probability.toFixed(3)
      : "";
  return [
    activity.type,
    normalizeActivityText(activity.actor),
    activity.marketId ?? "",
    normalizeActivityText(activity.question).slice(0, 120),
    normalizeActivityText(activity.outcome),
    normalizeActivityText(activity.amount),
    probability,
    normalizeActivityText(activity.debateTarget),
    normalizeActivityText(activity.detail).slice(0, 160),
  ].join("|");
}

/**
 * GET /api/activity?limit=30
 * Unified activity endpoint merging on-chain events with in-memory agent actions.
 */
export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10);

  try {
    const [persistedActions, persistedSnapshots, networkContributions] = await Promise.all([
      getPersistedLoopActions(Math.max(limit, 200)),
      getPersistedMarketSnapshots(500),
      listPersistedNetworkContributions({ limit: Math.max(limit * 4, 200) }),
    ]);
    for (const snapshot of persistedSnapshots) {
      if (snapshot.question) {
        registerQuestion(snapshot.id, snapshot.question);
      }
    }
    for (const action of persistedActions) {
      if (
        action.type === "market_creation" &&
        typeof action.marketId === "number" &&
        Number.isFinite(action.marketId) &&
        action.question
      ) {
        registerQuestion(action.marketId, action.question);
      }
    }

    // Get market addresses for event indexing (on-chain first, persisted fallback).
    const markets = await getMarkets();
    const fallbackMarkets =
      markets.length > 0
        ? markets
        : persistedSnapshots.map((snapshot) => ({
            id: snapshot.id,
            address: snapshot.address,
            questionHash: snapshot.questionHash,
          }));
    const addresses = fallbackMarkets
      .map((m) => m.address)
      .filter((a) => a !== "0x0" && !a.startsWith("0xpending"));
    const marketQuestions = new Map(
      fallbackMarkets.map((m) => [m.id, resolveMarketQuestion(m.id, m.questionHash)] as const)
    );

    // Fetch on-chain events and in-memory agent actions in parallel
    const shouldFetchOnChain =
      addresses.length > 0 || config.MARKET_FACTORY_ADDRESS !== "0x0";

    const [onChainEvents, inMemoryActions] = await Promise.all([
      shouldFetchOnChain
        ? getOnChainActivities(addresses, limit, config.MARKET_FACTORY_ADDRESS)
        : Promise.resolve([]),
      Promise.resolve(agentLoop.getActionLog(limit)),
    ]);

    const actionMap = new Map<string, any>();
    for (const action of [...persistedActions, ...inMemoryActions]) {
      actionMap.set(action.id, action);
    }
    const agentActions = Array.from(actionMap.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);

    // Normalize agent actions into the same shape
    const normalizedAgentActions = agentActions
      .filter(
        (a) =>
          a.type === "bet" ||
          a.type === "prediction" ||
          a.type === "market_creation" ||
          a.type === "resolution" ||
          a.type === "defi_swap" ||
          a.type === "debate"
      )
      .map((a) => ({
        id: a.id,
        type: a.type as string,
        actor: a.agentName,
        isAgent: true,
        marketId: a.marketId,
        question: a.question ?? a.defiPair ?? undefined,
        outcome: a.betOutcome ?? a.resolutionOutcome,
        amount: a.betAmount ?? a.defiAmount,
        probability: a.probability,
        detail: a.detail,
        debateTarget: a.debateTarget,
        txHash: a.txHash,
        reasoningHash: a.reasoningHash,
        timestamp: a.timestamp,
      }));

    const normalizedNetworkContributions = networkContributions.map((entry) => {
      const type =
        entry.kind === "forecast"
          ? "prediction"
          : entry.kind === "bet"
            ? "bet"
            : entry.kind === "market"
              ? "market_creation"
              : "debate";
      return {
        id: entry.id,
        type,
        actor: entry.actorName,
        isAgent: entry.actorType === "agent",
        marketId: entry.marketId,
        question: entry.question,
        outcome: entry.outcome,
        amount:
          typeof entry.amountStrk === "number"
            ? `${entry.amountStrk.toFixed(2)} STRK`
            : undefined,
        probability: entry.probability,
        detail: entry.content,
        txHash: entry.txHash,
        timestamp: entry.createdAt,
      };
    });

    // Normalize on-chain events
    const normalizedOnChain = onChainEvents.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor.slice(0, 10) + "..." + e.actor.slice(-4),
      isAgent: false,
      marketAddress: e.marketAddress,
      marketId: e.marketId,
      question:
        e.marketId !== undefined
          ? marketQuestions.get(e.marketId) ?? `Market #${e.marketId}`
          : undefined,
      outcome:
        e.type === "bet"
          ? e.outcome === 1
            ? "YES"
            : e.outcome === 0
              ? "NO"
              : undefined
          : undefined,
      amount:
        e.type === "bet" && e.amount
          ? `${(Number(BigInt(e.amount)) / 1e18).toFixed(0)} STRK`
          : undefined,
      probability: e.type === "prediction" ? e.probability : undefined,
      txHash: e.txHash,
      timestamp: e.timestamp,
    }));

    // Merge and deduplicate by txHash
    const seenTxHash = new Set<string>();
    const seenSignature = new Set<string>();
    const merged = [
      ...normalizedAgentActions,
      ...normalizedNetworkContributions,
      ...normalizedOnChain,
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((activity) => {
        if (activity.txHash) {
          if (seenTxHash.has(activity.txHash)) return false;
          seenTxHash.add(activity.txHash);
        }
        const signature = activitySignature(activity);
        if (seenSignature.has(signature)) return false;
        seenSignature.add(signature);
        return true;
      });

    const source =
      merged.length === 0
        ? "empty"
        : shouldFetchOnChain
          ? "on-chain"
          : "agent-loop";

    return NextResponse.json({
      activities: merged.slice(0, limit),
      source,
    });
  } catch (err: any) {
    return NextResponse.json({ activities: [], source: "error", error: err.message });
  }
}
