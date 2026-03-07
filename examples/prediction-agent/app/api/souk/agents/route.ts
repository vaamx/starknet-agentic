import { NextRequest, NextResponse } from "next/server";
import { listRegisteredAgents } from "@/lib/agent-souk";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const typeFilter = searchParams.get("type") ?? "";

  try {
    const result = await listRegisteredAgents(offset, limit);

    const filtered = typeFilter
      ? result.agents.filter((a) => a.agentType.toLowerCase() === typeFilter.toLowerCase())
      : result.agents;

    return NextResponse.json({
      agents: filtered,
      total: result.total,
      offset,
      limit,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch agents" },
      { status: 500 }
    );
  }
}
