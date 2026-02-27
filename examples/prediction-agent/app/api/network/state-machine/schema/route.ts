import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api-guard";
import { NETWORK_STATE_MACHINE_SCHEMA } from "@/lib/network-protocol";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_state_machine_schema_get", {
    windowMs: 60_000,
    maxRequests: 240,
  });
  if (rateLimited) return rateLimited;

  return Response.json(NETWORK_STATE_MACHINE_SCHEMA, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
