import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api-guard";
import { buildNetworkStateMachine } from "@/lib/network-protocol";

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
  const rateLimited = await enforceRateLimit(request, "network_state_machine_get", {
    windowMs: 60_000,
    maxRequests: 240,
  });
  if (rateLimited) return rateLimited;

  const baseUrl = resolveBaseUrl(request);
  const compact = request.nextUrl.searchParams.get("compact") === "true";
  const stateMachine = buildNetworkStateMachine(baseUrl);
  const machines = compact
    ? stateMachine.machines.map((machine) => ({
        id: machine.id,
        title: machine.title,
        initialState: machine.initialState,
        terminalStates: machine.terminalStates,
      }))
    : stateMachine.machines;

  return Response.json({
    ok: true,
    ...stateMachine,
    machines,
    count: stateMachine.machines.length,
    schemaUrl: `${baseUrl}/api/network/state-machine/schema`,
  });
}
