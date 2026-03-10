import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { getPrismaClient } from "@/lib/prisma";
import { nowUnix } from "@/lib/db";

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

const favoriteSchema = z.object({
  marketId: z.number().int().min(0),
});

const batchSchema = z.object({
  marketIds: z.array(z.number().int().min(0)).min(1).max(50),
});

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ favorites: [] });
  }

  const prisma = await getPrismaClient();
  if (!prisma) return NextResponse.json({ favorites: [] });

  const favorites = await prisma.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { marketId: true, createdAt: true },
  });

  return NextResponse.json({
    favorites: favorites.map((f: any) => f.marketId),
  });
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Support batch mode for onboarding
  const batchParsed = batchSchema.safeParse(body);
  if (batchParsed.success) {
    const prisma = await getPrismaClient();
    if (!prisma) return NextResponse.json({ ok: true });

    const now = nowUnix();
    await Promise.all(
      batchParsed.data.marketIds.map((marketId) =>
        prisma.favorite.upsert({
          where: { userId_marketId: { userId: user.id, marketId } },
          update: {},
          create: { id: makeId("fav"), userId: user.id, marketId, createdAt: now },
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  const parsed = favoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const prisma = await getPrismaClient();
  if (!prisma) return NextResponse.json({ ok: true });

  await prisma.favorite.upsert({
    where: { userId_marketId: { userId: user.id, marketId: parsed.data.marketId } },
    update: {},
    create: {
      id: makeId("fav"),
      userId: user.id,
      marketId: parsed.data.marketId,
      createdAt: nowUnix(),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const marketId = Number(request.nextUrl.searchParams.get("marketId"));
  if (!Number.isFinite(marketId) || marketId < 0) {
    return NextResponse.json({ error: "Invalid marketId" }, { status: 400 });
  }

  const prisma = await getPrismaClient();
  if (!prisma) return NextResponse.json({ ok: true });

  await prisma.favorite.deleteMany({
    where: { userId: user.id, marketId },
  });

  return NextResponse.json({ ok: true });
}
