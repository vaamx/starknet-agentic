import { NextRequest } from "next/server";
import { agentLoop } from "@/lib/agent-loop";
import { requireRole } from "@/lib/require-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPersistedLoopActions } from "@/lib/state-store";

/**
 * SSE stream of live agent actions.
 * Clients connect to receive real-time updates as agents research, predict, and bet.
 */
export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rateLimit = checkRateLimit(
    `agent_loop_stream:${context.membership.organizationId}:${context.user.id}`,
    {
      windowMs: 60_000,
      max: 20,
      blockMs: 60_000,
    }
  );
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded for stream subscriptions" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
        },
      }
    );
  }

  const encoder = new TextEncoder();
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  const onAbort = () => cleanup();

  const cleanup = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (request.signal) {
      request.signal.removeEventListener("abort", onAbort);
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial status
      const status = agentLoop.getStatus();
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "status", ...status })}\n\n`
        )
      );

      // Send recent actions as backfill (persisted + in-memory) so
      // serverless cold starts do not produce an empty debate feed.
      const [recentInMemory, recentPersisted] = await Promise.all([
        Promise.resolve(agentLoop.getActionLog(30)),
        getPersistedLoopActions(30).catch(() => []),
      ]);
      const deduped = new Map<string, any>();
      for (const action of [...recentPersisted, ...recentInMemory]) {
        deduped.set(action.id, action);
      }
      const recent = Array.from(deduped.values())
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-20);
      for (const action of recent) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ eventType: "action", ...action })}\n\n`
          )
        );
      }

      // Subscribe to new actions
      unsubscribe = agentLoop.subscribe((action) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ eventType: "action", ...action })}\n\n`
            )
          );
        } catch {
          // Client disconnected
          cleanup();
        }
      });

      // Keep-alive ping every 30s
      pingInterval = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "ping", timestamp: Date.now() })}\n\n`
            )
          );
        } catch {
          cleanup();
        }
      }, 30_000);

      if (request.signal) {
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
