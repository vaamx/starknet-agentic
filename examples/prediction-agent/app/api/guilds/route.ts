import { NextRequest, NextResponse } from "next/server";
import { listGuilds } from "@/lib/economy-reader";

export const runtime = "nodejs";

// Mock fallback
const MOCK_GUILDS = [
  {
    guildId: 1,
    name: "Forecasters Guild",
    creator: "0x04a3c9f2e8b1d7a6c5f0e3d2b8a1c7f6e5d4c3b2a10987654321fedcba9876",
    memberCount: 47,
    totalStaked: 128500,
    minStake: 500,
    createdAt: Date.now() - 86400000 * 45,
    activeProposals: 3,
    description: "Elite prediction agents collaborating on superforecasting.",
    tags: ["forecasting", "ensemble", "superforecasting"],
  },
  {
    guildId: 2,
    name: "DeFi Hunters",
    creator: "0x07b2e1a3c8d9f6e5d4c3b2a1098765432fedcba9876543210abcdef12345678",
    memberCount: 31,
    totalStaked: 89200,
    minStake: 1000,
    createdAt: Date.now() - 86400000 * 30,
    activeProposals: 1,
    description: "Arbitrage detection and DeFi yield optimization.",
    tags: ["defi", "arbitrage", "yield"],
  },
  {
    guildId: 3,
    name: "Sentinel Collective",
    creator: "0x02c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4",
    memberCount: 19,
    totalStaked: 42800,
    minStake: 250,
    createdAt: Date.now() - 86400000 * 14,
    activeProposals: 2,
    description: "On-chain security monitoring and threat detection.",
    tags: ["security", "monitoring", "validation"],
  },
  {
    guildId: 4,
    name: "Research Syndicate",
    creator: "0x05f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5",
    memberCount: 12,
    totalStaked: 31400,
    minStake: 200,
    createdAt: Date.now() - 86400000 * 7,
    activeProposals: 0,
    description: "Multi-source research agents pooling intelligence.",
    tags: ["research", "data", "intelligence"],
  },
  {
    guildId: 5,
    name: "Autonomous Vanguard",
    creator: "0x08a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
    memberCount: 8,
    totalStaked: 15600,
    minStake: 100,
    createdAt: Date.now() - 86400000 * 2,
    activeProposals: 1,
    description: "Experimental agent autonomy and self-replication.",
    tags: ["autonomy", "replication", "experimental"],
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const sort = searchParams.get("sort") ?? "members";

  // Try on-chain first
  try {
    const result = await listGuilds(offset, limit, sort);
    if (result.total > 0) {
      return NextResponse.json({
        guilds: result.guilds,
        total: result.total,
        offset,
        limit,
        source: "onchain",
      });
    }
  } catch {
    // Fall through to mock
  }

  // Mock fallback
  let guilds = [...MOCK_GUILDS];
  guilds.sort((a, b) => {
    if (sort === "staked") return b.totalStaked - a.totalStaked;
    if (sort === "newest") return b.createdAt - a.createdAt;
    return b.memberCount - a.memberCount;
  });
  const total = guilds.length;
  guilds = guilds.slice(offset, offset + limit);

  return NextResponse.json({ guilds, total, offset, limit, source: "mock" });
}
