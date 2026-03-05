/**
 * Research Agent — Enriches forecasting with real-world data.
 *
 * Gathers data from multiple sources before invoking Claude for analysis,
 * producing a research-backed forecast rather than a pure LLM prediction.
 */

import {
  gatherResearch,
  buildResearchBrief,
  type DataSourceResult,
  type DataSourceName,
} from "./data-sources/index";
import { forecastMarket, type ForecastResult } from "./agent-forecaster";
import {
  agenticForecastMarket,
  type AgenticForecastEvent,
} from "./forecast-tools";
import { config } from "./config";
import { completeText, resolveLlmModel } from "./llm-provider";
import type { AgentPersona } from "./agent-personas";

export interface ResearchEvent {
  type:
    | "research_start"
    | "research_complete"
    | "tool_call"
    | "tool_result"
    | "forecast_text"
    | "forecast_complete";
  sources?: DataSourceName[];
  results?: DataSourceResult[];
  content?: string;
  toolName?: string;
  toolUseId?: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  source?: string;
  dataPoints?: number;
  probability?: number;
  reasoning?: string;
}

export interface MarketContext {
  currentMarketProb?: number;
  totalPool?: string;
  agentPredictions?: { agent: string; prob: number; brier: number }[];
  timeUntilResolution?: string;
  systemPrompt?: string;
  model?: string;
}

async function triageResearchBrief(question: string, brief: string): Promise<string> {
  if (!config.agentResearchTriageEnabled || !config.llmTriageConfigured) {
    return brief;
  }

  const truncated =
    brief.length > 14_000 ? `${brief.slice(0, 14_000)}\n...[truncated]` : brief;

  try {
    const triage = await completeText({
      task: "triage",
      model: resolveLlmModel("triage"),
      maxTokens: 420,
      temperature: 0.1,
      enableXaiResearchTools: false,
      systemPrompt:
        "You are a research triage agent. Condense noisy source output into decision-grade evidence for a forecaster.",
      userMessage:
        `Question: "${question}"\n\n` +
        "Research evidence:\n" +
        `${truncated}\n\n` +
        "Return exactly 4 sections:\n" +
        "1) Confirmed facts (bullets)\n" +
        "2) Conflicting signals (bullets)\n" +
        "3) Missing evidence required to resolve uncertainty (bullets)\n" +
        "4) Calibration note (1-2 lines, no probability)\n",
    });

    const cleaned = triage.trim();
    return cleaned.length > 0 ? cleaned : brief;
  } catch {
    return brief;
  }
}

/**
 * Research and forecast pipeline for a single agent persona.
 * Yields events as research progresses through data gathering and analysis.
 */
export async function* researchAndForecast(
  persona: AgentPersona,
  question: string,
  marketContext: MarketContext,
  sourceOverrides?: DataSourceName[]
): AsyncGenerator<ResearchEvent, ForecastResult> {
  const sources = sourceOverrides ?? persona.preferredSources ?? [
    "polymarket",
    "coingecko",
    "news",
    "social",
  ];

  // 1. Signal research start
  yield {
    type: "research_start",
    sources: sources as DataSourceName[],
  };

  // 2. Gather data from relevant sources
  const results = await gatherResearch(
    question,
    sources as DataSourceName[]
  );

  yield {
    type: "research_complete",
    results,
  };

  // 3. Build research brief
  const brief = buildResearchBrief(results);
  const triagedBrief = await triageResearchBrief(question, brief);

  // 4. Run forecast with enriched context
  const useToolUse = config.toolUseEnabled;
  const generator = useToolUse
    ? agenticForecastMarket(question, {
        ...marketContext,
        researchBrief: triagedBrief,
      })
    : forecastMarket(question, {
        ...marketContext,
        researchBrief: triagedBrief,
      });

  let fullText = "";
  let result: ForecastResult | undefined;

  while (true) {
    const { value, done } = await generator.next();
    if (done) {
      result = value as ForecastResult;
      break;
    }

    if (useToolUse) {
      const event = value as AgenticForecastEvent;
      if (event.type === "reasoning_chunk") {
        fullText += event.content;
        yield { type: "forecast_text", content: event.content };
      } else if (event.type === "tool_call") {
        yield {
          type: "tool_call",
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
        };
      } else if (event.type === "tool_result") {
        yield {
          type: "tool_result",
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          result: event.result,
          isError: event.isError,
          source: event.source,
          dataPoints: event.dataPoints,
        };
      }
    } else {
      const chunk = value as string;
      fullText += chunk;
      yield { type: "forecast_text", content: chunk };
    }
  }

  const finalResult = result ?? { reasoning: fullText, probability: 0.5 };

  yield {
    type: "forecast_complete",
    probability: finalResult.probability,
    reasoning: finalResult.reasoning,
  };

  return finalResult;
}

/**
 * Quick research-only call (no forecast) — used by the data-sources API endpoint.
 */
export async function quickResearch(
  question: string,
  sources?: DataSourceName[]
): Promise<DataSourceResult[]> {
  return gatherResearch(question, sources);
}
