import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/require-auth";

export async function GET(request: NextRequest) {
  const context = requireMembership(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: context.user,
    organization: {
      id: context.membership.organizationId,
      name: context.membership.organizationName,
      slug: context.membership.organizationSlug,
    },
    role: context.membership.role,
  });
}
