import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/require-auth";
import { buildAgentBrief, getAutomationPolicyWithRuntime } from "@/lib/automation-engine";

export const runtime = "nodejs";

const querySchema = z.object({
  marketId: z.coerce.number().int().min(0),
});

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const parsed = querySchema.parse({
      marketId: request.nextUrl.searchParams.get("marketId"),
    });

    const runtimePayload = await getAutomationPolicyWithRuntime({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      marketId: parsed.marketId,
    });

    const brief = await buildAgentBrief({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      marketId: parsed.marketId,
      policy: runtimePayload.policy,
    });

    if (!brief) {
      return NextResponse.json(
        { error: "Market brief is unavailable" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      brief,
      policy: runtimePayload.policy,
      summary: runtimePayload.summary,
      recentRuns: runtimePayload.recentRuns,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to load agent brief" },
      { status: 500 }
    );
  }
}
