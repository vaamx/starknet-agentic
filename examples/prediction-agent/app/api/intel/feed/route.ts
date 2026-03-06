import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getIntelFeed } from "@/lib/intel-feed";
import { requireMembership } from "@/lib/require-auth";

export const runtime = "nodejs";

const querySchema = z.object({
  question: z.string().trim().min(3).max(280),
  category: z.string().trim().min(1).max(40).optional(),
  marketId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(3).max(12).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const membership = requireMembership(request);
    const parsed = querySchema.parse({
      question:
        request.nextUrl.searchParams.get("question") ?? "Prediction markets",
      category: request.nextUrl.searchParams.get("category") ?? undefined,
      marketId: request.nextUrl.searchParams.get("marketId") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    const payload = await getIntelFeed({
      question: parsed.question,
      category: parsed.category,
      marketId: parsed.marketId,
      limit: parsed.limit,
      organizationId: membership?.membership.organizationId,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to build intel feed" },
      { status: 500 }
    );
  }
}
