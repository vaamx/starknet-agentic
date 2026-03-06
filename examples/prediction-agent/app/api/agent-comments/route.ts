import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/require-auth";
import {
  listAgentCommentPreviews,
  listAgentComments,
  recordAgentComment,
} from "@/lib/ops-store";

export const runtime = "nodejs";

const postSchema = z.object({
  marketId: z.number().int().min(0),
  content: z.string().trim().min(1).max(2400),
  parentId: z.string().trim().min(2).max(120).optional(),
  agentId: z.string().trim().min(2).max(180).optional(),
  actorName: z.string().trim().min(2).max(120).optional(),
  sourceType: z.string().trim().min(2).max(64).optional(),
  reliabilityScore: z.number().min(0).max(1).optional(),
  backtestConfidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function parseIntParam(
  raw: string | null,
  bounds?: { min?: number; max?: number }
): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  const min = bounds?.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds?.max ?? Number.POSITIVE_INFINITY;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseMarketIds(raw: string | null): number[] {
  if (!raw) return [];
  const values = raw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.trunc(entry));
  return Array.from(new Set(values)).slice(0, 50);
}

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = parseIntParam(
    request.nextUrl.searchParams.get("marketId"),
    { min: 0 }
  );
  const marketIds = parseMarketIds(request.nextUrl.searchParams.get("marketIds"));
  const limit =
    parseIntParam(request.nextUrl.searchParams.get("limit"), { min: 1, max: 300 }) ??
    60;
  const perMarket =
    parseIntParam(request.nextUrl.searchParams.get("limitPerMarket"), {
      min: 1,
      max: 5,
    }) ?? 1;
  const orderRaw = request.nextUrl.searchParams.get("order");
  const order = orderRaw === "asc" ? "asc" : "desc";

  if (marketIds.length > 0) {
    const byMarket = await listAgentCommentPreviews({
      organizationId: context.membership.organizationId,
      marketIds,
      perMarket,
    });
    return NextResponse.json({ byMarket });
  }

  const comments = await listAgentComments({
    organizationId: context.membership.organizationId,
    marketId: marketId ?? undefined,
    limit,
    order,
  });

  return NextResponse.json({ comments });
}

export async function POST(request: NextRequest) {
  const context = requireRole(request, "analyst");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = postSchema.parse(await request.json());
    const comment = await recordAgentComment({
      organizationId: context.membership.organizationId,
      marketId: body.marketId,
      parentId: body.parentId ?? null,
      userId: context.user.id,
      agentId: body.agentId ?? null,
      actorName: body.actorName ?? context.user.name,
      content: body.content,
      sourceType: body.sourceType ?? "manual-ui",
      reliabilityScore: body.reliabilityScore ?? null,
      backtestConfidence: body.backtestConfidence ?? null,
      metadataJson: body.metadata ? JSON.stringify(body.metadata) : null,
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to post agent comment" },
      { status: 500 }
    );
  }
}
