import { NextRequest, NextResponse } from "next/server";
import {
  formatMetricsPrometheus,
  getAgentMetricsSnapshot,
} from "@/lib/agent-metrics";

function parseActionLimit(raw: string | null): number | null {
  if (!raw) return 200;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  const actionLimit = parseActionLimit(request.nextUrl.searchParams.get("limit"));
  if (!actionLimit) {
    return NextResponse.json(
      { ok: false, error: "limit must be a positive integer" },
      { status: 400 }
    );
  }

  const snapshot = getAgentMetricsSnapshot({ actionLimit });

  if (format === "prometheus") {
    return new Response(formatMetricsPrometheus(snapshot), {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (format !== "json") {
    return NextResponse.json(
      { ok: false, error: "format must be 'json' or 'prometheus'" },
      { status: 400 }
    );
  }

  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
