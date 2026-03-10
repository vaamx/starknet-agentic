import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import {
  completeText,
  getLlmProviderForTask,
  getLlmConfigurationError,
  resolveLlmModel,
} from "./llm-provider";
import {
  isOpenForecasterModel,
  buildOpenForecasterPrompt,
  parseOpenForecasterResponse,
  ensembleForecast,
} from "./openforecaster";

const SYSTEM_PROMPT = `You are a calibrated superforecaster AI agent operating on Starknet.

Your task is to analyze prediction market questions and produce well-calibrated probability estimates.

Follow this process:
1. **Base Rate**: Start with the historical base rate for similar events
2. **Inside View**: Analyze specific evidence for this particular question
3. **Outside View**: Consider reference classes of similar predictions
4. **Update**: Adjust based on recent data, trends, and market conditions
5. **Calibrate**: Check for overconfidence — move toward 50% if uncertain

Rules:
- Always output a specific probability as a percentage (e.g., "**My estimate: 67%**")
- Show your reasoning transparently — users are watching you think
- Consider both sides of the question
- Be honest about uncertainty
- Reference specific data when possible (crypto prices, network metrics, historical trends)
- Your probability should reflect your genuine epistemic state, not what you think users want to hear

End your analysis with exactly this format on its own line:
**My estimate: XX%**`;

export interface ForecastResult {
  reasoning: string;
  probability: number;
}

function* chunkText(text: string, size = 120): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

/** Stream a forecast analysis from Claude. Yields reasoning text chunks. */
export async function* forecastMarket(
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
): AsyncGenerator<string, ForecastResult> {
  const forecastProvider = getLlmProviderForTask("forecast");
  if (!config.llmForecastConfigured) {
    throw new Error(getLlmConfigurationError("forecast"));
  }

  let contextStr = "";
  if (context.currentMarketProb !== undefined) {
    contextStr += `\nCurrent market probability: ${(context.currentMarketProb * 100).toFixed(1)}%`;
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

  let researchStr = "";
  if (context.researchBrief) {
    researchStr = `\n\n--- RESEARCH DATA ---\n${context.researchBrief}\n--- END RESEARCH DATA ---`;
  }

  const userMessage = `Analyze this prediction market question and provide your probability estimate:\n\n"${question}"${contextStr}${researchStr}`;
  const model = resolveLlmModel("forecast", context.model);
  let fullText = "";

  if (forecastProvider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(getLlmConfigurationError("forecast"));
    }
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model,
      max_tokens: 1024,
      system: context.systemPrompt ?? SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullText += event.delta.text;
        yield event.delta.text;
      }
    }
  } else if (forecastProvider === "local" && isOpenForecasterModel(model)) {
    // OpenForecaster-8B path: use ensemble forecasting with XML tag format
    const ensembleResult = await ensembleForecast(
      question,
      {
        researchBrief: context.researchBrief,
        currentMarketProb: context.currentMarketProb,
        timeUntilResolution: context.timeUntilResolution,
        agentPredictions: context.agentPredictions,
        model,
      },
      config.openForecasterEnsembleCount
    );
    fullText = ensembleResult.reasoning;
    for (const chunk of chunkText(fullText)) {
      yield chunk;
    }
    return { reasoning: fullText, probability: ensembleResult.probability };
  } else if (forecastProvider === "xai" && process.env.XAI_API_KEY) {
    // xAI streaming path — use OpenAI-compatible streaming API for real-time output
    const xaiBaseUrl = config.xaiBaseUrl || "https://api.x.ai/v1";
    const messages: Array<{ role: string; content: string }> = [];
    if (context.systemPrompt ?? SYSTEM_PROMPT) {
      messages.push({ role: "system", content: context.systemPrompt ?? SYSTEM_PROMPT });
    }
    messages.push({ role: "user", content: userMessage });

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 1024,
    };

    // No AbortSignal.timeout here — xAI with native tools (web_search, x_search)
    // streams data incrementally over 30-50s. The outer per-agent timeout handles limits.
    const res = await fetch(`${xaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`xAI streaming request failed (HTTP ${res.status}): ${errBody.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("xAI response has no body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            yield content;
          }
        } catch { /* skip malformed */ }
      }
    }
  } else {
    fullText = await completeText({
      task: "forecast",
      model,
      systemPrompt: context.systemPrompt ?? SYSTEM_PROMPT,
      userMessage,
      maxTokens: 1024,
      enableXaiResearchTools: true,
    });
    for (const chunk of chunkText(fullText)) {
      yield chunk;
    }
  }

  const probability = extractProbability(fullText);
  if (probability === null) {
    throw new Error("Model response missing probability");
  }
  return { reasoning: fullText, probability };
}

/** Extract probability from Claude's response. */
export function extractProbability(text: string): number | null {
  // Look for "**My estimate: XX%**" pattern
  const match = text.match(/\*\*My estimate:\s*(\d+(?:\.\d+)?)%\*\*/i);
  if (match) return Math.max(0, Math.min(1, parseFloat(match[1]) / 100));

  // Fallback: look for any "XX%" near the end
  const fallback = text.match(/(\d+(?:\.\d+)?)%/g);
  if (fallback && fallback.length > 0) {
    const last = fallback[fallback.length - 1];
    return Math.max(0, Math.min(1, parseFloat(last) / 100));
  }

  return null;
}
