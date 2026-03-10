import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { getPrismaClient } from "@/lib/prisma";
import { nowUnix } from "@/lib/db";

function makeId(): string {
  return `uw_${randomBytes(12).toString("hex")}`;
}

const linkSchema = z.object({
  walletAddress: z.string().trim().min(4).max(120),
  provider: z.string().trim().max(50).optional(),
  label: z.string().trim().max(100).optional(),
  chainId: z.string().trim().max(30).optional(),
});

const updateSchema = z.object({
  walletAddress: z.string().trim().min(4).max(120),
  label: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

/** GET /api/wallets — list all wallets for the authenticated user */
export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ wallets: [] });
  }

  const prisma = await getPrismaClient();
  if (!prisma) return NextResponse.json({ wallets: [] });

  const wallets = await prisma.userWallet.findMany({
    where: { userId: user.id },
    orderBy: [{ isPrimary: "desc" }, { lastUsedAt: "desc" }],
    select: {
      id: true,
      walletAddress: true,
      provider: true,
      label: true,
      isPrimary: true,
      chainId: true,
      verifiedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ wallets });
}

/** POST /api/wallets — link a new wallet to the user */
export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const prisma = await getPrismaClient();
  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const addr = parsed.data.walletAddress.toLowerCase();
  const now = nowUnix();

  // Check if wallet is already linked to another user
  const existing = await prisma.userWallet.findUnique({
    where: { walletAddress: addr },
  });
  if (existing && existing.userId !== user.id) {
    return NextResponse.json(
      { error: "This wallet is already linked to another account" },
      { status: 409 }
    );
  }

  // Check how many wallets this user has
  const count = await prisma.userWallet.count({ where: { userId: user.id } });
  const isFirst = count === 0;

  const wallet = await prisma.userWallet.upsert({
    where: { userId_walletAddress: { userId: user.id, walletAddress: addr } },
    update: {
      provider: parsed.data.provider ?? undefined,
      label: parsed.data.label ?? undefined,
      chainId: parsed.data.chainId ?? undefined,
      lastUsedAt: now,
    },
    create: {
      id: makeId(),
      userId: user.id,
      walletAddress: addr,
      provider: parsed.data.provider ?? "unknown",
      label: parsed.data.label ?? null,
      isPrimary: isFirst, // first wallet is automatically primary
      chainId: parsed.data.chainId ?? "SN_SEPOLIA",
      verifiedAt: now,
      lastUsedAt: now,
      createdAt: now,
    },
  });

  return NextResponse.json({ ok: true, wallet });
}

/** PATCH /api/wallets — update wallet label or set as primary */
export async function PATCH(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const prisma = await getPrismaClient();
  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const addr = parsed.data.walletAddress.toLowerCase();

  // Verify ownership
  const existing = await prisma.userWallet.findUnique({
    where: { userId_walletAddress: { userId: user.id, walletAddress: addr } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  // If setting as primary, unset all others first
  if (parsed.data.isPrimary) {
    await prisma.$transaction([
      prisma.userWallet.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false },
      }),
      prisma.userWallet.update({
        where: { id: existing.id },
        data: {
          isPrimary: true,
          label: parsed.data.label !== undefined ? parsed.data.label : undefined,
        },
      }),
    ]);
  } else if (parsed.data.label !== undefined) {
    await prisma.userWallet.update({
      where: { id: existing.id },
      data: { label: parsed.data.label },
    });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/wallets?address=0x... — unlink a wallet */
export async function DELETE(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const addr = request.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!addr) {
    return NextResponse.json({ error: "Missing address param" }, { status: 400 });
  }

  const prisma = await getPrismaClient();
  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  await prisma.userWallet.deleteMany({
    where: { userId: user.id, walletAddress: addr },
  });

  return NextResponse.json({ ok: true });
}
