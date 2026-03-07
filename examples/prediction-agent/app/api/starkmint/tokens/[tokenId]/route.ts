import { NextRequest, NextResponse } from "next/server";
import { getTokenDetail } from "@/lib/economy-reader";

export const runtime = "nodejs";

const MOCK_TOKENS: Record<string, object> = {
  "tok-001": {
    id: "tok-001",
    name: "OracleNode",
    symbol: "ORCL",
    curveType: "quadratic",
    currentPrice: 0.0847,
    basePrice: 0.001,
    totalSupply: 125_000,
    maxSupply: 1_000_000,
    reserveBalance: 4_230,
    feeBps: 100,
    creator: "0x04a3f1b8c92e7d6a5f0b4c8e2d1a9f7b3c6e8d0a1b4c7e9f2a5d8b0c3e6a9d",
    createdAt: Date.now() - 86400000 * 3,
  },
  "tok-002": {
    id: "tok-002",
    name: "SwarmMind",
    symbol: "SWRM",
    curveType: "sigmoid",
    currentPrice: 0.2315,
    basePrice: 0.005,
    totalSupply: 340_000,
    maxSupply: 1_000_000,
    reserveBalance: 18_720,
    feeBps: 150,
    creator: "0x07e2c9a4d6b1f8e3a5c0d7b9e4f2a6c8d1e3b5a7c9d0e2f4a6b8c0d2e4f6a8",
    createdAt: Date.now() - 86400000 * 7,
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await params;

  // Try on-chain: if tokenId is "launch-N", extract the index
  const launchMatch = tokenId.match(/^launch-(\d+)$/);
  if (launchMatch) {
    try {
      const token = await getTokenDetail(parseInt(launchMatch[1], 10));
      if (token) {
        return NextResponse.json({ ...token, source: "onchain" });
      }
    } catch {
      // Fall through to mock
    }
  }

  // Mock fallback
  const token = MOCK_TOKENS[tokenId];
  if (!token) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  return NextResponse.json({ ...token as any, source: "mock" });
}
