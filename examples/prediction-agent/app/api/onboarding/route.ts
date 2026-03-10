import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { getPrismaClient } from "@/lib/prisma";
import { nowUnix } from "@/lib/db";

const VALID_INTERESTS = [
  "crypto", "politics", "sports", "tech", "finance",
  "climate", "culture", "world", "geopolitics", "economy",
  "elections", "earnings",
];

const onboardingSchema = z.object({
  interests: z.array(z.string()).min(1).max(12),
});

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid interests" }, { status: 400 });
  }

  const interests = parsed.data.interests.filter((i) => VALID_INTERESTS.includes(i));
  if (interests.length === 0) {
    return NextResponse.json({ error: "Select at least one interest" }, { status: 400 });
  }

  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        interests: JSON.stringify(interests),
        onboardingCompleted: true,
        updatedAt: nowUnix(),
      },
    });
  }

  return NextResponse.json({ ok: true, interests });
}
