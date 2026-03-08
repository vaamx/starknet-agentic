import { NextRequest, NextResponse } from "next/server";
import { getGuildDetail } from "@/lib/economy-reader";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const { guildId } = await params;
  const numericId = parseInt(guildId, 10);

  if (isNaN(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid guild ID" }, { status: 400 });
  }

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
  } catch (err) {
    console.warn(`[guilds/${guildId}] on-chain fetch failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch guild from on-chain" },
      { status: 500 }
    );
  }

  return NextResponse.json({ error: "Guild not found" }, { status: 404 });
}
