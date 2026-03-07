import { NextRequest, NextResponse } from "next/server";
import { getAgentProfile } from "@/lib/agent-souk";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId: rawId } = await params;
  const agentId = parseInt(rawId, 10);
  if (!Number.isFinite(agentId) || agentId < 1) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  try {
    const profile = await getAgentProfile(agentId);
    if (!profile) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent: profile });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch agent" },
      { status: 500 }
    );
  }
}
