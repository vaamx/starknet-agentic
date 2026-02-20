import { NextRequest, NextResponse } from "next/server";
import { getOnChainActivities } from "@/lib/event-indexer";
import { agentLoop } from "@/lib/agent-loop";
import { getMarkets, MARKET_QUESTIONS } from "@/lib/market-reader";
import { config } from "@/lib/config";

/**
 * GET /api/activity?limit=30
 * Unified activity endpoint merging on-chain events with in-memory agent actions.
 */
export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10);

  try {
    // Get market addresses for event indexing
    const markets = await getMarkets();
    const addresses = markets.map((m) => m.address).filter((a) => a !== "0x0" && !a.startsWith("0xpending"));

    // Fetch on-chain events and in-memory agent actions in parallel
    const shouldFetchOnChain =
      addresses.length > 0 || config.MARKET_FACTORY_ADDRESS !== "0x0";

    const [onChainEvents, agentActions] = await Promise.all([
      shouldFetchOnChain
        ? getOnChainActivities(addresses, limit, config.MARKET_FACTORY_ADDRESS)
        : Promise.resolve([]),
      Promise.resolve(agentLoop.getActionLog(limit)),
    ]);

    // Normalize agent actions into the same shape
    const normalizedAgentActions = agentActions
      .filter(
        (a) =>
          a.type === "bet" ||
          a.type === "prediction" ||
          a.type === "market_creation" ||
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
        outcome: a.betOutcome,
        amount: a.betAmount ?? a.defiAmount,
        probability: a.probability,
        detail: a.detail,
        debateTarget: a.debateTarget,
        txHash: a.txHash,
        reasoningHash: a.reasoningHash,
        timestamp: a.timestamp,
      }));

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
          ? MARKET_QUESTIONS[e.marketId] ?? `Market #${e.marketId}`
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
    const seen = new Set<string>();
    const merged = [...normalizedAgentActions, ...normalizedOnChain].filter((a) => {
      if (a.txHash && seen.has(a.txHash)) return false;
      if (a.txHash) seen.add(a.txHash);
      return true;
    });

    // Sort by timestamp descending (newest first)
    merged.sort((a, b) => b.timestamp - a.timestamp);

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
