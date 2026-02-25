/**
 * OpenClaw A2A Outbound Delegation
 * POST /api/openclaw/delegate
 *
 * Fetches an external agent card, finds its predict endpoint,
 * proxies the forecast SSE stream back to the caller with source tagging.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import { config } from "@/lib/config";
import { validatePeerUrl } from "@/lib/peer-url-safety";

export const maxDuration = 60;
const delegateBodySchema = z.object({
  agentCardUrl: z.string().url(),
  question: z.string().trim().min(3).max(500),
  marketId: z.number().int().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "openclaw_delegate", {
    windowMs: 60_000,
    maxRequests: 20,
  });
  if (rateLimited) return rateLimited;

  let agentCardUrl: string;
  let question: string;
  let marketId: number | undefined;
  try {
    const body = delegateBodySchema.parse(await request.json());
    ({ agentCardUrl, question, marketId } = body);
  } catch (err: any) {
    return jsonError("Invalid request body", 400, err?.issues ?? err?.message);
  }

  const validatedCardUrl = validatePeerUrl(
    agentCardUrl,
    config.openclawAllowPrivatePeers
  );
  if (!validatedCardUrl.ok) {
    return jsonError(
      `Unsafe agentCardUrl: ${validatedCardUrl.error}`,
      400
    );
  }
  agentCardUrl = validatedCardUrl.url.toString();

  const normalizedQuestion = question.trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        // 1. Fetch external agent card
        const cardRes = await fetch(agentCardUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (!cardRes.ok) {
          throw new Error(`Failed to fetch agent card: HTTP ${cardRes.status}`);
        }
        const card = await cardRes.json();

        // 2. Find predict endpoint — check card.url + /api/predict or skills[].endpoint
        const cardBaseRaw =
          typeof card?.url === "string" ? card.url : new URL(agentCardUrl).origin;
        const validatedBaseUrl = validatePeerUrl(
          cardBaseRaw,
          config.openclawAllowPrivatePeers
        );
        if (!validatedBaseUrl.ok) {
          throw new Error(`Unsafe base URL from agent card: ${validatedBaseUrl.error}`);
        }
        const baseUrl = validatedBaseUrl.url.origin;
        let predictEndpoint = `${baseUrl}/api/predict`;

        if (Array.isArray(card.skills)) {
          const predictSkill = card.skills.find(
            (s: any) => s.id === "predict" && typeof s.endpoint === "string"
          );
          if (predictSkill?.endpoint) {
            const validatedPredict = validatePeerUrl(
              predictSkill.endpoint,
              config.openclawAllowPrivatePeers
            );
            if (!validatedPredict.ok) {
              throw new Error(
                `Unsafe predict endpoint from agent card: ${validatedPredict.error}`
              );
            }
            predictEndpoint = validatedPredict.url.toString();
          }
        }

        send({
          type: "delegate_start",
          sourceAgent: card.name ?? agentCardUrl,
          agentCardUrl,
          predictEndpoint,
        });

        // 3. POST to external agent's predict endpoint
        const forecastRes = await fetch(predictEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: normalizedQuestion, marketId }),
          signal: AbortSignal.timeout(55000),
        });

        if (!forecastRes.ok) {
          throw new Error(
            `External agent returned HTTP ${forecastRes.status} from ${predictEndpoint}`
          );
        }

        // 4. Proxy the SSE stream with source tagging
        const reader = forecastRes.body?.getReader();
        if (!reader) throw new Error("No response body from external agent");

        const decoder = new TextDecoder();
        let buffer = "";
        // streamDone exits the outer chunk-reader loop when the upstream [DONE]
        // sentinel is received. A plain `break` inside the for-of line loop would
        // only exit that inner loop, leaving the outer while running indefinitely.
        let streamDone = false;

        while (!streamDone) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") {
              send({ type: "delegate_done", sourceAgent: card.name });
              streamDone = true;
              break;
            }
            try {
              const event = JSON.parse(raw);
              // Tag every proxied event with source info
              send({
                ...event,
                sourceAgent: card.name ?? agentCardUrl,
                delegated: true,
              });
            } catch {
              // Skip malformed events
            }
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error("[openclaw/delegate] Error:", msg);
        send({ type: "error", message: msg });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
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
