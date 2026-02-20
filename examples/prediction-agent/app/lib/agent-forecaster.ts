import Anthropic from "@anthropic-ai/sdk";

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const client = new Anthropic({ apiKey });

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

  let fullText = "";

  const stream = client.messages.stream({
    model: context.model ?? "claude-sonnet-4-5-20250929",
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
  if (match) return parseFloat(match[1]) / 100;

  // Fallback: look for any "XX%" near the end
  const fallback = text.match(/(\d+(?:\.\d+)?)%/g);
  if (fallback && fallback.length > 0) {
    const last = fallback[fallback.length - 1];
    return parseFloat(last) / 100;
  }

  return null;
}
