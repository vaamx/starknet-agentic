import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/require-auth";
import {
  getAutomationRunSummary,
  listAutomationPolicies,
  upsertAutomationPolicy,
} from "@/lib/automation-store";
import { getAutomationPolicyWithRuntime } from "@/lib/automation-engine";

export const runtime = "nodejs";

const surfaceSchema = z.enum(["starkzap", "avnu", "direct"]);
const statusSchema = z.enum([
  "active",
  "paused",
  "stop_loss",
  "budget_exhausted",
]);

const upsertPolicySchema = z.object({
  marketId: z.number().int().min(0),
  enabled: z.boolean(),
  cadenceMinutes: z.number().int().min(5).max(1440),
  maxStakeStrk: z.number().positive().max(1_000_000),
  riskLimitStrk: z.number().positive().max(1_000_000),
  stopLossPct: z.number().min(1).max(99),
  confidenceThreshold: z.number().min(0.01).max(0.49),
  preferredSurface: surfaceSchema,
  allowFallbackToDirect: z.boolean(),
  status: statusSchema.optional(),
});

function parseMarketId(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = parseMarketId(request.nextUrl.searchParams.get("marketId"));
  if (marketId !== null) {
    const result = await getAutomationPolicyWithRuntime({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      marketId,
    });
    return NextResponse.json({
      policy: result.policy,
      summary: result.summary,
      recentRuns: result.recentRuns,
    });
  }

  const policies = await listAutomationPolicies(
    context.membership.organizationId,
    context.user.id
  );
  const enriched = await Promise.all(
    policies.map(async (policy) => ({
      ...policy,
      summary: await getAutomationRunSummary(policy.id),
    }))
  );
  return NextResponse.json({ policies: enriched });
}

export async function POST(request: NextRequest) {
  const context = requireRole(request, "analyst");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = upsertPolicySchema.parse(await request.json());
    const policy = await upsertAutomationPolicy({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      marketId: body.marketId,
      enabled: body.enabled,
      cadenceMinutes: body.cadenceMinutes,
      maxStakeStrk: body.maxStakeStrk,
      riskLimitStrk: body.riskLimitStrk,
      stopLossPct: body.stopLossPct,
      confidenceThreshold: body.confidenceThreshold,
      preferredSurface: body.preferredSurface,
      allowFallbackToDirect: body.allowFallbackToDirect,
      status: body.status,
    });
    const summary = await getAutomationRunSummary(policy.id);
    return NextResponse.json({ policy, summary });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to save automation policy" },
      { status: 500 }
    );
  }
}
