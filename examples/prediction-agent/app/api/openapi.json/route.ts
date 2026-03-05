import { NextRequest } from "next/server";
import { buildOpenApiSpec } from "@/lib/openapi-spec";

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
  const baseUrl = resolveBaseUrl(request);
  const spec = buildOpenApiSpec(baseUrl);
  return Response.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
