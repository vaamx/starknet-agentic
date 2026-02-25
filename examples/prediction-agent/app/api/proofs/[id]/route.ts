import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api-guard";
import { getProofRecord } from "@/lib/proof-pipeline";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimited = await enforceRateLimit(request, "proofs_get_by_id", {
    windowMs: 60_000,
    maxRequests: 120,
  });
  if (rateLimited) return rateLimited;

  const { id } = await params;
  const proof = await getProofRecord(id);
  if (!proof) {
    return Response.json({ error: "Proof not found" }, { status: 404 });
  }

  return Response.json({ proof });
}
