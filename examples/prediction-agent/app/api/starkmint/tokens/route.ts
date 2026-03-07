import { NextRequest, NextResponse } from "next/server";
import { listTokens } from "@/lib/economy-reader";

export const runtime = "nodejs";

// Mock fallback
const MOCK_LAUNCHES = [
  {
    id: "tok-001",
    name: "OracleNode",
    symbol: "ORCL",
    curveType: "quadratic",
    currentPrice: 0.0847,
    totalSupply: 125_000,
    reserveBalance: 4_230,
    creator: "0x04a3f1b8c92e7d6a5f0b4c8e2d1a9f7b3c6e8d0a1b4c7e9f2a5d8b0c3e6a9d",
    createdAt: Date.now() - 86400000 * 3,
    volume24h: 1_840,
    priceDirection: "up",
    agentId: 1,
  },
  {
    id: "tok-002",
    name: "SwarmMind",
    symbol: "SWRM",
    curveType: "sigmoid",
    currentPrice: 0.2315,
    totalSupply: 340_000,
    reserveBalance: 18_720,
    creator: "0x07e2c9a4d6b1f8e3a5c0d7b9e4f2a6c8d1e3b5a7c9d0e2f4a6b8c0d2e4f6a8",
    createdAt: Date.now() - 86400000 * 7,
    volume24h: 5_200,
    priceDirection: "up",
  },
  {
    id: "tok-003",
    name: "DeFiSage",
    symbol: "SAGE",
    curveType: "linear",
    currentPrice: 0.012,
    totalSupply: 45_000,
    reserveBalance: 890,
    creator: "0x01b3a5c7d9e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0",
    createdAt: Date.now() - 86400000,
    volume24h: 320,
    priceDirection: "flat",
  },
  {
    id: "tok-004",
    name: "NeuralStrike",
    symbol: "NSTK",
    curveType: "quadratic",
    currentPrice: 0.543,
    totalSupply: 890_000,
    reserveBalance: 72_400,
    creator: "0x06d8e0a2b4c6d8f0a2b4c6d8e0a2b4c6d8f0a2b4c6d8e0a2b4c6d8f0a2b4c6",
    createdAt: Date.now() - 86400000 * 14,
    volume24h: 12_350,
    priceDirection: "down",
  },
  {
    id: "tok-005",
    name: "PhiAgent",
    symbol: "PHI",
    curveType: "sigmoid",
    currentPrice: 0.0034,
    totalSupply: 12_000,
    reserveBalance: 210,
    creator: "0x03a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3",
    createdAt: Date.now() - 3600000 * 6,
    volume24h: 85,
    priceDirection: "up",
    agentId: 4,
  },
  {
    id: "tok-006",
    name: "HuginnCore",
    symbol: "HGN",
    curveType: "linear",
    currentPrice: 0.051,
    totalSupply: 78_000,
    reserveBalance: 2_100,
    creator: "0x09f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9",
    createdAt: Date.now() - 86400000 * 5,
    volume24h: 960,
    priceDirection: "down",
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const curveType = searchParams.get("curveType") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  // Try on-chain first
  try {
    const result = await listTokens(offset, limit, curveType);
    if (result.total > 0) {
      return NextResponse.json({
        tokens: result.tokens,
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
  let tokens = [...MOCK_LAUNCHES];
  if (curveType && curveType !== "all") {
    tokens = tokens.filter((t) => t.curveType === curveType);
  }
  const total = tokens.length;
  tokens = tokens.slice(offset, offset + limit);

  return NextResponse.json({ tokens, total, offset, limit, source: "mock" });
}
