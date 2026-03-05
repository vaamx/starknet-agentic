/**
 * Agentic Forecast Tools — Tool-use loop for superforecasting.
 *
 * Transforms Claude from a classifier into a genuine agent:
 * - Claude autonomously calls research tools mid-reasoning
 * - Data sources are exposed as discoverable tools
 * - Tool calls / results stream as SSE events
 * - Feature flag: AGENT_TOOL_USE_ENABLED=false → falls back to forecastMarket()
 *
 * Architecture:
 *   messages.create() for tool turns (fast, synchronous)
 *   messages.stream()  for final synthesis (token-by-token streaming)
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import { forecastMarket, extractProbability, type ForecastResult } from "./agent-forecaster";
import {
  getLlmConfigurationError,
  getLlmProviderForTask,
  resolveLlmModel,
} from "./llm-provider";
import {
  fetchTavilySearch,
  fetchPolymarketData,
  fetchCryptoPrices,
  fetchEspnScores,
  fetchStarknetOnchain,
} from "./data-sources/index";
import { fetchWebSearch } from "./data-sources/web-search";
import { fetchNewsData } from "./data-sources/news-search";
import { fetchSocialTrends } from "./data-sources/social-trends";

// ── Event types ────────────────────────────────────────────────────────────

export type AgenticForecastEvent =
  | { type: "tool_call"; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      toolName: string;
      toolUseId: string;
      result: string;
      isError?: boolean;
      source?: string;
      dataPoints?: number;
    }
  | { type: "reasoning_chunk"; content: string };

// ── Tool definitions ──────────────────────────────────────────────────────

const FORECAST_TOOLS: Anthropic.Tool[] = [
  {
    name: "web_search",
    description:
      "Search the web for current information relevant to this prediction market question. Uses Tavily (AI-synthesized answer) with Brave as fallback. Best for recent news, outcomes, and facts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant information",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_news_headlines",
    description:
      "Fetch current news headlines for the market topic. Uses Brave News API. Prefer this for geopolitical, macro, regulation, and event-resolution markets.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "Question or topic to query for recent news coverage",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "get_social_signals",
    description:
      "Fetch social trend signals from X and Telegram integrations. Use for narrative momentum, sentiment shifts, and breaking chatter.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Short topic query for social trend extraction",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_polymarket_odds",
    description:
      "Fetch current prediction market odds from Polymarket for a related question. Useful for calibrating against crowd wisdom.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "Topic or question to search for on Polymarket",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "get_crypto_prices",
    description:
      "Fetch current cryptocurrency prices and 24-hour change from CoinGecko. Essential for crypto-related markets.",
    input_schema: {
      type: "object" as const,
      properties: {
        tokens: {
          type: "string",
          description:
            "Comma-separated token names or symbols (e.g. 'ethereum,starknet,bitcoin')",
        },
      },
      required: ["tokens"],
    },
  },
  {
    name: "get_sports_data",
    description:
      "Fetch live or recent sports scores and stats from ESPN. Essential for sports-related markets.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Sport, team, or game query (e.g. 'NFL Super Bowl', 'Kansas City Chiefs')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_starknet_onchain",
    description:
      "Fetch on-chain Starknet metrics: TVL, TPS, active addresses, token prices. Use for Starknet-specific markets.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Metric or question about Starknet on-chain data",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "log_reasoning_step",
    description:
      "Commit an intermediate reasoning step with your current probability estimate. Use this after each major piece of evidence to track your calibration process.",
    input_schema: {
      type: "object" as const,
      properties: {
        step: {
          type: "string",
          description: "Brief description of this reasoning step and key evidence",
        },
        probability_estimate: {
          type: "number",
          description:
            "Your current probability estimate (0.0-1.0) based on evidence gathered so far",
        },
      },
      required: ["step", "probability_estimate"],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────

async function executeForecasterTool(
  name: string,
  input: Record<string, unknown>
): Promise<{
  text: string;
  isError: boolean;
  source: string;
  dataPoints: number;
}> {
  try {
    switch (name) {
      case "web_search": {
        const query = String(input.query ?? "");
        // Try Tavily first; fall back to Brave web search
        const result = await fetchTavilySearch(query);
        if (result.data.length > 0) {
          const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
          return {
            text: lines.join("\n"),
            isError: false,
            source: result.source,
            dataPoints: result.data.length,
          };
        }
        // Brave fallback
        const braveResult = await fetchWebSearch(query);
        const braveLines = [
          braveResult.summary,
          ...braveResult.data.map((d) => `• ${d.label}: ${d.value}`),
        ];
        return {
          text: braveLines.join("\n"),
          isError: false,
          source: braveResult.source,
          dataPoints: braveResult.data.length,
        };
      }

      case "get_polymarket_odds": {
        const question = String(input.question ?? "");
        const result = await fetchPolymarketData(question);
        if (result.data.length === 0) {
          return {
            text: result.summary,
            isError: false,
            source: result.source,
            dataPoints: 0,
          };
        }
        const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
        return {
          text: lines.join("\n"),
          isError: false,
          source: result.source,
          dataPoints: result.data.length,
        };
      }

      case "get_news_headlines": {
        const question = String(input.question ?? "");
        const result = await fetchNewsData(question);
        if (result.data.length === 0) {
          return {
            text: result.summary,
            isError: false,
            source: result.source,
            dataPoints: 0,
          };
        }
        const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
        return {
          text: lines.join("\n"),
          isError: false,
          source: result.source,
          dataPoints: result.data.length,
        };
      }

      case "get_social_signals": {
        const query = String(input.query ?? "");
        const result = await fetchSocialTrends(query);
        if (result.data.length === 0) {
          return {
            text: result.summary,
            isError: false,
            source: result.source,
            dataPoints: 0,
          };
        }
        const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
        return {
          text: lines.join("\n"),
          isError: false,
          source: result.source,
          dataPoints: result.data.length,
        };
      }

      case "get_crypto_prices": {
        const tokens = String(input.tokens ?? "");
        const result = await fetchCryptoPrices(tokens);
        if (result.data.length === 0) {
          return {
            text: result.summary,
            isError: false,
            source: result.source,
            dataPoints: 0,
          };
        }
        const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
        return {
          text: lines.join("\n"),
          isError: false,
          source: result.source,
          dataPoints: result.data.length,
        };
      }

      case "get_sports_data": {
        const query = String(input.query ?? "");
        const result = await fetchEspnScores(query);
        if (result.data.length === 0) {
          return {
            text: result.summary,
            isError: false,
            source: result.source,
            dataPoints: 0,
          };
        }
        const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
        return {
          text: lines.join("\n"),
          isError: false,
          source: result.source,
          dataPoints: result.data.length,
        };
      }

      case "get_starknet_onchain": {
        const query = String(input.query ?? "");
        const result = await fetchStarknetOnchain(query);
        if (result.data.length === 0) {
          return {
            text: result.summary,
            isError: false,
            source: result.source,
            dataPoints: 0,
          };
        }
        const lines = [result.summary, ...result.data.map((d) => `• ${d.label}: ${d.value}`)];
        return {
          text: lines.join("\n"),
          isError: false,
          source: result.source,
          dataPoints: result.data.length,
        };
      }

      case "log_reasoning_step": {
        // Visible no-op: forces Claude to commit to intermediate estimates
        const prob = Number(input.probability_estimate ?? 0);
        return {
          text: `Reasoning step logged. Current estimate: ${(prob * 100).toFixed(1)}% YES. Continue analysis.`,
          isError: false,
          source: "reasoning_step",
          dataPoints: 0,
        };
      }

      default:
        return {
          text: `Unknown tool: ${name}`,
          isError: true,
          source: name,
          dataPoints: 0,
        };
    }
  } catch (err: any) {
    // Never throw — return error as text, Claude continues
    return {
      text: `Tool error: ${err?.message ?? String(err)}`,
      isError: true,
      source: name,
      dataPoints: 0,
    };
  }
}

// ── Agentic forecast generator ────────────────────────────────────────────

const AGENTIC_SYSTEM_PROMPT = `You are a calibrated superforecaster AI agent operating on Starknet.

Your task is to analyze prediction market questions and produce well-calibrated probability estimates.
You have access to research tools — use them to gather evidence before deciding.

Process:
1. **Plan**: Identify what data you need to answer this question
2. **Research**: Call relevant tools (web_search, get_polymarket_odds, get_crypto_prices, etc.)
3. **Base Rate**: After gathering data, establish the historical base rate for similar events
4. **Inside View**: Analyze specific evidence from your research
5. **Outside View**: Consider reference classes of similar predictions
6. **Calibrate**: Check for overconfidence — move toward 50% if uncertain
7. **Log Step**: Use log_reasoning_step to commit intermediate estimates
8. **Conclude**: State your final probability

Rules:
- Always call at least 2 research tools before concluding
- For fast-moving or narrative-driven markets, include both get_news_headlines and get_social_signals
- Use log_reasoning_step after major evidence updates
- End your final analysis with exactly: **My estimate: XX%**
- Show your reasoning transparently — users are watching you think
- Be honest about uncertainty`;

/**
 * Agentic forecast generator.
 * Yields AgenticForecastEvents during tool-use rounds, then reasoning chunks during synthesis.
 * Returns ForecastResult (same shape as forecastMarket).
 *
 * Feature flag: AGENT_TOOL_USE_ENABLED=false → delegates to forecastMarket().
 */
export async function* agenticForecastMarket(
  question: string,
  context: {
    currentMarketProb?: number;
    totalPool?: string;
    agentPredictions?: { agent: string; prob: number; brier: number }[];
    timeUntilResolution?: string;
    researchBrief?: string;
    systemPrompt?: string;
    model?: string;
  }
): AsyncGenerator<AgenticForecastEvent, ForecastResult> {
  // Feature flag check — instant rollback via the typed derived helper.
  // config.toolUseEnabled is false ONLY when AGENT_TOOL_USE_ENABLED is explicitly "false".
  if (!config.toolUseEnabled) {
    // Fall back to original context-injection mode
    const gen = forecastMarket(question, context);
    let result: ForecastResult | undefined;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value as ForecastResult;
        break;
      }
      yield { type: "reasoning_chunk", content: value as string };
    }
    return result!;
  }

  const systemPrompt = context.systemPrompt ?? AGENTIC_SYSTEM_PROMPT;
  const model = resolveLlmModel("forecast", context.model);
  const forecastProvider = getLlmProviderForTask("forecast");
  if (!config.llmForecastConfigured) {
    throw new Error(getLlmConfigurationError("forecast"));
  }

  // xAI path uses native provider tools directly in forecastMarket().
  if (forecastProvider === "xai") {
    yield {
      type: "tool_call",
      toolName: "xai_native_tools",
      toolUseId: `xai_${Date.now()}`,
      input: {
        web_search: config.xaiWebSearchEnabled,
        x_search: config.xaiXSearchEnabled,
        code_execution: config.xaiCodeExecutionEnabled,
        collections_search: config.xaiCollectionsSearchEnabled,
      },
    };
    const gen = forecastMarket(question, {
      ...context,
      systemPrompt,
      model,
    });
    let result: ForecastResult | undefined;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value as ForecastResult;
        break;
      }
      yield { type: "reasoning_chunk", content: value as string };
    }
    return result!;
  }

  // Local-model path currently runs deterministic source gathering + final local synthesis
  // via forecastMarket() without Anthropic function-calling turns.
  if (forecastProvider === "local") {
    yield {
      type: "tool_call",
      toolName: "local_model_forecast",
      toolUseId: `local_${Date.now()}`,
      input: {
        provider: "ollama",
        model,
      },
    };
    const gen = forecastMarket(question, {
      ...context,
      systemPrompt,
      model,
    });
    let result: ForecastResult | undefined;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value as ForecastResult;
        break;
      }
      yield { type: "reasoning_chunk", content: value as string };
    }
    return result!;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(getLlmConfigurationError("forecast"));
  }

  const client = new Anthropic({ apiKey });
  // config.toolMaxTurns is already clamped to [1, 20] and parsed at startup.
  const maxTurns = config.toolMaxTurns;

  // Build initial context string
  let contextStr = "";
  if (context.currentMarketProb !== undefined) {
    contextStr += `\nCurrent market implied probability: ${(context.currentMarketProb * 100).toFixed(1)}%`;
  }
  if (context.totalPool) {
    contextStr += `\nTotal pool: ${context.totalPool} tokens`;
  }
  if (context.timeUntilResolution) {
    contextStr += `\nTime until resolution: ${context.timeUntilResolution}`;
  }
  if (context.agentPredictions?.length) {
    contextStr += "\nOther agent predictions:";
    for (const p of context.agentPredictions) {
      contextStr += `\n  - ${p.agent}: ${(p.prob * 100).toFixed(0)}% (Brier: ${p.brier.toFixed(3)})`;
    }
  }

  const userMessage = `Analyze this prediction market question and provide your probability estimate.\n\nQuestion: "${question}"${contextStr}\n\nUse the available research tools to gather evidence before concluding.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let fullReasoning = "";
  let turnsUsed = 0;

  // ── Tool-use loop ──────────────────────────────────────────────────────
  while (turnsUsed < maxTurns) {
    turnsUsed++;

    // Use non-streaming create() for tool turns — fast, returns quickly
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      tools: FORECAST_TOOLS,
      messages,
    });

    // Collect text blocks and tool use blocks
    const textBlocks: string[] = [];
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textBlocks.push(block.text);
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block);
      }
    }

    // Yield any text as reasoning chunks
    for (const text of textBlocks) {
      fullReasoning += text;
      yield { type: "reasoning_chunk", content: text };
    }

    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      // Done with tool use — push assistant message and break
      messages.push({ role: "assistant", content: response.content });
      break;
    }

    // Process tool use blocks
    messages.push({ role: "assistant", content: response.content });

    // ── Three-phase concurrent tool execution ────────────────────────────
    //
    // Phase 1: emit all tool_call events immediately so the UI shows the
    //          agent's full research plan before any network I/O starts.
    //
    // Phase 2: fire all tool fetchers in parallel — they are independent
    //          (web_search, polymarket, crypto, espn all hit different APIs).
    //          Sequential execution was adding latencies; with N=3 tools at
    //          ~2 s each that saves ~4 s per tool-use round.
    //
    // Phase 3: emit tool_result events and push calldata in declaration order
    //          so the message history is deterministic regardless of which
    //          fetcher resolves first.
    //
    // executeForecasterTool() never throws — its own catch returns isError:true.
    // Promise.allSettled is used defensively in case that invariant ever breaks.

    // Phase 1 — announce
    for (const toolBlock of toolUseBlocks) {
      yield {
        type: "tool_call",
        toolName: toolBlock.name,
        toolUseId: toolBlock.id,
        input: toolBlock.input as Record<string, unknown>,
      };
    }

    // Phase 2 — execute concurrently
    const toolOutputs = await Promise.allSettled(
      toolUseBlocks.map((toolBlock) =>
        executeForecasterTool(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        )
      )
    );

    // Phase 3 — collect results in declaration order, emit, push to history
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (let i = 0; i < toolUseBlocks.length; i++) {
      const toolBlock = toolUseBlocks[i];
      const settled = toolOutputs[i];
      const toolOutput =
        settled.status === "fulfilled"
          ? settled.value
          : {
              text: `Tool execution threw: ${(settled as PromiseRejectedResult).reason}`,
              isError: true as const,
              source: toolBlock.name,
              dataPoints: 0,
            };

      yield {
        type: "tool_result",
        toolName: toolBlock.name,
        toolUseId: toolBlock.id,
        result: toolOutput.text,
        isError: toolOutput.isError,
        source: toolOutput.source,
        dataPoints: toolOutput.dataPoints,
      };

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: toolOutput.text,
        is_error: toolOutput.isError,
      });
    }

    // Push tool results as a user turn
    messages.push({ role: "user", content: toolResults });
  }

  // ── Final synthesis (streaming) ────────────────────────────────────────
  // A synthesis pass is needed only when the last message is a user turn
  // carrying tool results — meaning Claude has not yet written its final text.
  //
  // The old condition `turnsUsed >= maxTurns || ...` was incorrect:
  //   if the final turn ended with stop_reason="end_turn" AND turnsUsed===maxTurns,
  //   it triggered an unnecessary streaming call even though Claude already wrote
  //   its full answer, wasting tokens and adding latency.
  //
  // The correct invariant:
  //   - end_turn break   → last message is assistant (text) → no synthesis needed
  //   - maxTurns reached → last message is user (tool results array) → synthesis needed
  //   Both cases are captured by the single check below.
  const lastMessage = messages[messages.length - 1];
  const needsSynthesis =
    lastMessage.role === "user" && Array.isArray(lastMessage.content);

  if (needsSynthesis) {
    messages.push({
      role: "user",
      content:
        "Based on your research above, provide your final calibrated probability estimate. End with **My estimate: XX%**",
    });

    const stream = client.messages.stream({
      model,
      max_tokens: 512,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullReasoning += event.delta.text;
        yield { type: "reasoning_chunk", content: event.delta.text };
      }
    }
  }

  // ── Extract probability ────────────────────────────────────────────────
  const probability = extractProbability(fullReasoning);
  if (probability === null) {
    const fallbackProbability =
      typeof context.currentMarketProb === "number"
        ? context.currentMarketProb
        : 0.5;
    const fallbackReasoning =
      (fullReasoning?.trim() || "Model returned reasoning without a numeric estimate.") +
      `\n\nFallback probability applied: ${(fallbackProbability * 100).toFixed(
        1
      )}% YES (model output missing explicit estimate).`;
    return { reasoning: fallbackReasoning, probability: fallbackProbability };
  }

  return { reasoning: fullReasoning, probability };
}
