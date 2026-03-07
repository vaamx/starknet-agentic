import { NextRequest, NextResponse } from "next/server";
import { getGuildDetail } from "@/lib/economy-reader";

export const runtime = "nodejs";

const MOCK_GUILDS: Record<string, object> = {
  "1": {
    guildId: 1,
    name: "Forecasters Guild",
    creator: "0x04a3c9f2e8b1d7a6c5f0e3d2b8a1c7f6e5d4c3b2a10987654321fedcba9876",
    description: "Elite prediction agents collaborating on superforecasting. Stake-weighted ensemble models for market resolution.",
    memberCount: 47,
    totalStaked: 128500,
    minStake: 500,
    createdAt: Date.now() - 86400000 * 45,
    tags: ["forecasting", "ensemble", "superforecasting"],
    members: [
      { address: "0x04a3c9f2e8b1d7a6c5f0e3d2b8a1c7f6e5d4c3b2a10987654321fedcba9876", stakeAmount: 15000, joinedAt: Date.now() - 86400000 * 45 },
      { address: "0x07b2e1a3c8d9f6e5d4c3b2a1098765432fedcba9876543210abcdef12345678", stakeAmount: 8500, joinedAt: Date.now() - 86400000 * 38 },
      { address: "0x02c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4", stakeAmount: 5200, joinedAt: Date.now() - 86400000 * 30 },
    ],
    proposals: [
      {
        id: 1,
        description: "Increase minimum stake to 750 STRK.",
        status: "active",
        yesVotes: 18200,
        noVotes: 6400,
        quorum: 64250,
        totalVoters: 29,
        deadline: Date.now() + 86400000 * 3,
        creator: "0x04a3c9f2e8b1d7a6c5f0e3d2b8a1c7f6e5d4c3b2a10987654321fedcba9876",
      },
      {
        id: 2,
        description: "Allocate 5000 STRK for Tavily API subscription.",
        status: "passed",
        yesVotes: 42000,
        noVotes: 8100,
        quorum: 38550,
        totalVoters: 38,
        deadline: Date.now() - 86400000 * 2,
        creator: "0x07b2e1a3c8d9f6e5d4c3b2a1098765432fedcba9876543210abcdef12345678",
      },
    ],
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const { guildId } = await params;
  const numericId = parseInt(guildId, 10);

  // Try on-chain first
  if (!isNaN(numericId) && numericId > 0) {
    try {
      const guild = await getGuildDetail(numericId);
      if (guild) {
        return NextResponse.json({
          ...guild,
          // On-chain doesn't store description text or tags
          description: null,
          tags: [],
          members: [],
          source: "onchain",
        });
      }
    } catch {
      // Fall through to mock
    }
  }

  // Mock fallback
  const guild = MOCK_GUILDS[guildId];
  if (!guild) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
  }

  return NextResponse.json({ ...guild as any, source: "mock" });
}
