import { usePrismaRuntime, getPrismaClient } from "./prisma";
import { db } from "./db";

export type MembershipRole = "owner" | "admin" | "analyst" | "viewer";

export interface MembershipContext {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MembershipRole;
}

const ROLE_RANK: Record<MembershipRole, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
  owner: 4,
};

export function hasRoleAtLeast(
  role: MembershipRole,
  required: MembershipRole
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

async function getPrimaryMembershipPrisma(
  userId: string
): Promise<MembershipContext | null> {
  const prisma = await getPrismaClient();
  if (!prisma) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      role: true,
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  if (!membership) return null;

  // Sort by role rank — findFirst doesn't support CASE ordering, so fetch top candidates
  return {
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    role: membership.role as MembershipRole,
  };
}

function getPrimaryMembershipSqlite(userId: string): MembershipContext | null {
  const row = db
    .prepare(
      `
      SELECT
        o.id as organizationId,
        o.name as organizationName,
        o.slug as organizationSlug,
        m.role as role
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ?
      ORDER BY
        CASE m.role
          WHEN 'owner' THEN 4
          WHEN 'admin' THEN 3
          WHEN 'analyst' THEN 2
          ELSE 1
        END DESC,
        m.created_at ASC
      LIMIT 1
      `
    )
    .get(userId) as MembershipContext | undefined;

  return row ?? null;
}

const usePrisma = usePrismaRuntime();

export async function getPrimaryMembership(
  userId: string
): Promise<MembershipContext | null> {
  if (usePrisma) return getPrimaryMembershipPrisma(userId);
  return getPrimaryMembershipSqlite(userId);
}
