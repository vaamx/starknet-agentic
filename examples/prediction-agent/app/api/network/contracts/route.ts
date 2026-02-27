import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api-guard";
import { buildContractsRegistry } from "@/lib/network-protocol";

export const runtime = "nodejs";

function resolveBaseUrl(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_contracts_get", {
    windowMs: 60_000,
    maxRequests: 240,
  });
  if (rateLimited) return rateLimited;

  const configuredOnly = request.nextUrl.searchParams.get("configured") === "true";
  const baseUrl = resolveBaseUrl(request);
  const registry = buildContractsRegistry(baseUrl);
  const contracts = configuredOnly
    ? registry.contracts.filter((contract) => contract.configured)
    : registry.contracts;

  return Response.json({
    ...registry,
    contracts,
    count: contracts.length,
    configuredCount: registry.contracts.filter((contract) => contract.configured).length,
    filters: {
      configuredOnly,
    },
  });
}
