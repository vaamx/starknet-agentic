import { NextRequest } from "next/server";
import { forecastMarket, extractProbability } from "@/lib/agent-forecaster";
import { agenticForecastMarket, type AgenticForecastEvent } from "@/lib/forecast-tools";
import { getMarketById, getAgentPredictions, MARKET_QUESTIONS } from "@/lib/market-reader";
import { AGENT_PERSONAS } from "@/lib/agent-personas";
import { recordPrediction } from "@/lib/starknet-executor";
import { logThoughtOnChain } from "@/lib/huginn-executor";
import { requireX402 } from "@/lib/x402-middleware";
import { config } from "@/lib/config";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";

export const maxDuration = 60;
const predictBodySchema = z.object({
  marketId: z.number().int().min(1),
});

function isStreamClosedError(err: unknown): boolean {
  const message = String((err as any)?.message ?? err ?? "");
  return (
    message.includes("Controller is already closed") ||
    message.includes("ReadableStream is already closed") ||
    message.includes("Invalid state")
  );
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "predict", {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (rateLimited) return rateLimited;

  // Phase C: X-402 payment check — must happen BEFORE opening the SSE stream
  const paymentResult = await requireX402(request, "predict", config.x402PricePredict);
  if (paymentResult instanceof Response) return paymentResult; // HTTP 402

  let marketId: number;
  try {
    const body = predictBodySchema.parse(await request.json());
    marketId = body.marketId;
  } catch (err: any) {
    return jsonError("Invalid request body", 400, err?.issues ?? err?.message);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError("Anthropic API key not configured", 400);
  }

  // Return the stream immediately, do all work inside
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Fetch market data inside the stream to avoid pre-stream timeout
        const market = await getMarketById(marketId);

        if (!market) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Market not found" })}\n\n`
            )
          );
          controller.close();
          return;
        }

        const predictions = await getAgentPredictions(marketId);
        const question = MARKET_QUESTIONS[marketId] ?? `Market #${marketId}`;

        const daysUntil = Math.max(
          0,
          Math.floor((market.resolutionTime - Date.now() / 1000) / 86400)
        );

        const alphaPrompt =
          AGENT_PERSONAS.find((p) => p.id === "alpha")?.systemPrompt;

        const useToolUse = process.env.AGENT_TOOL_USE_ENABLED !== "false";

        const forecastContext = {
          currentMarketProb: market.impliedProbYes,
          totalPool: (market.totalPool / 10n ** 18n).toString(),
          agentPredictions: predictions.map((p) => ({
            agent: p.agent.slice(0, 10),
            prob: p.predictedProb,
            brier: p.brierScore,
          })),
          timeUntilResolution: `${daysUntil} days`,
          systemPrompt: alphaPrompt,
        };

        const generator = useToolUse
          ? agenticForecastMarket(question, forecastContext)
          : forecastMarket(question, forecastContext);

        let fullText = "";
        let result: any;

        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            result = value;
            break;
          }

          if (useToolUse) {
            const event = value as AgenticForecastEvent;
            if (event.type === "reasoning_chunk") {
              fullText += event.content;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "text", content: event.content })}\n\n`)
              );
            } else if (event.type === "tool_call") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "tool_call", toolName: event.toolName, toolUseId: event.toolUseId, input: event.input })}\n\n`)
              );
            } else if (event.type === "tool_result") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "tool_result",
                    toolName: event.toolName,
                    toolUseId: event.toolUseId,
                    result: event.result,
                    isError: event.isError,
                    source: event.source,
                    dataPoints: event.dataPoints,
                  })}\n\n`
                )
              );
            }
          } else {
            const chunk = value as string;
            fullText += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`)
            );
          }
        }

        const probability =
          result?.probability ?? extractProbability(fullText);
        if (probability === null) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Model output missing probability" })}\n\n`
            )
          );
          controller.close();
          return;
        }

        // Record prediction and log Huginn thought concurrently.
        // logThoughtOnChain() never throws — errors surface as HuginnLogResult.status="error".
        // recordPrediction() is safe to fire in parallel since it has its own error handling.
        const [txSettled, huginnSettled] = await Promise.allSettled([
          recordPrediction(marketId, probability),
          logThoughtOnChain(fullText),
        ]);

        const txResult =
          txSettled.status === "fulfilled" ? txSettled.value : null;
        const huginnResult =
          huginnSettled.status === "fulfilled" ? huginnSettled.value : null;

        // SHA-256 fingerprint of the reasoning — present on skip and success.
        const thoughtHash = huginnResult?.thoughtHash || undefined;
        // Starknet tx hash of the log_thought() call — only on Huginn success.
        const huginnTxHash =
          huginnResult?.status === "success" ? huginnResult.txHash : undefined;

        // Emit huginn_log before the final result so the UI can show it inline.
        if (huginnResult?.status === "success") {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "huginn_log",
                thoughtHash,
                huginnTxHash,
              })}\n\n`
            )
          );
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "result",
              probability,
              txHash: txResult?.txHash,
              txStatus: txResult?.status ?? "error",
              txError: txResult?.error,
              reasoningHash: thoughtHash,
              huginnTxHash,
            })}\n\n`
          )
        );

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err: any) {
        if (isStreamClosedError(err)) {
          return;
        }
        const msg = err.message || String(err);
        console.error("[predict] Error:", msg, err.stack);
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
            )
          );
        } catch {
          // Client likely disconnected; no-op.
        }
        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
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
