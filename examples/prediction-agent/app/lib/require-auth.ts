import type { NextRequest } from "next/server";
import { getUserFromSessionToken, sessionCookieName } from "./auth";
import { getPrimaryMembership, hasRoleAtLeast, type MembershipContext, type MembershipRole } from "./rbac";
import { validateMutatingRequest } from "./request-security";

export function requireAuth(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (!token) return null;
  return getUserFromSessionToken(token);
}

export function requireMembership(
  request: NextRequest
): { user: NonNullable<ReturnType<typeof getUserFromSessionToken>>; membership: MembershipContext } | null {
  const user = requireAuth(request);
  if (!user) return null;

  const membership = getPrimaryMembership(user.id);
  if (!membership) return null;

  return { user, membership };
}

export function requireRole(
  request: NextRequest,
  minRole: MembershipRole
): { user: NonNullable<ReturnType<typeof getUserFromSessionToken>>; membership: MembershipContext } | null {
  const boundary = validateMutatingRequest(request);
  if (!boundary.ok) return null;

  const context = requireMembership(request);
  if (!context) return null;
  if (!hasRoleAtLeast(context.membership.role, minRole)) return null;
  return context;
}
