import type { NextRequest } from "next/server";
import { getUserFromSessionToken, sessionCookieName, type AuthUser } from "./auth";
import { getPrimaryMembership, hasRoleAtLeast, type MembershipContext, type MembershipRole } from "./rbac";
import { validateMutatingRequest } from "./request-security";

export async function requireAuth(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (!token) return null;
  return getUserFromSessionToken(token);
}

export async function requireMembership(
  request: NextRequest
): Promise<{ user: AuthUser; membership: MembershipContext } | null> {
  const user = await requireAuth(request);
  if (!user) return null;

  const membership = await getPrimaryMembership(user.id);
  if (!membership) return null;

  return { user, membership };
}

export async function requireRole(
  request: NextRequest,
  minRole: MembershipRole
): Promise<{ user: AuthUser; membership: MembershipContext } | null> {
  const boundary = validateMutatingRequest(request);
  if (!boundary.ok) return null;

  const context = await requireMembership(request);
  if (!context) return null;
  if (!hasRoleAtLeast(context.membership.role, minRole)) return null;
  return context;
}
