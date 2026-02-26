import type { AgentPersona } from "./agent-personas";
import { AGENT_PERSONAS } from "./agent-personas";
import { config } from "./config";
import {
  completeText,
  getLlmConfigurationError,
  resolveLlmModel,
} from "./llm-provider";

export interface Round1Result {
  agentId: string;
  agentName: string;
  probability: number;
  brierScore: number | null;
}

export interface DebateResult {
  agentId: string;
  agentName: string;
  originalProbability: number;
  revisedProbability: number;
  debateReasoning: string;
}

const LOW_CREDIT_REGEX =
  /credit balance is too low|insufficient credit|plans\s*&\s*billing/i;
const DEBATE_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
let providerCooldownUntil = 0;
let providerCooldownReason = "";

function buildFallbackDebateMessage(params: {
  leadProbability: number;
  reason: string;
}): string {
  const estimate = Math.round(params.leadProbability * 100);
  const reason = params.reason.replace(/\s+/g, " ").trim();
  return (
    `Debate fallback active (${reason}). ` +
    `Holding lead estimate near ${estimate}% until model access recovers. ` +
    "Stance: UNCERTAIN"
  );
}

function extractDebateErrorMessage(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : (err as any)?.message ?? String(err ?? "unknown error");
  return raw.replace(/\s+/g, " ").trim();
}

function shouldEnterCooldown(errMessage: string): boolean {
  return LOW_CREDIT_REGEX.test(errMessage) || /429|rate limit/i.test(errMessage);
}

/**
 * Run a full debate round: each agent reviews the Round 1 results from all
 * other agents and may revise their own probability estimate.
 */
export async function runDebateRound(
  round1Results: Round1Result[],
  question: string,
  systemPrompts: Record<string, string>
): Promise<DebateResult[]> {
  if (!config.llmDebateConfigured) {
    throw new Error(getLlmConfigurationError("debate"));
  }
  const results: DebateResult[] = [];

  for (const agent of round1Results) {
    const otherForecasts = round1Results
      .filter((r) => r.agentId !== agent.agentId)
      .map(
        (r) =>
          `- ${r.agentName}: ${(r.probability * 100).toFixed(1)}%`
      )
      .join("\n");

    const persona = AGENT_PERSONAS.find((p) => p.id === agent.agentId);
    const systemPrompt = systemPrompts[agent.agentId] ?? persona?.systemPrompt ?? "";

    const system = `${systemPrompt}

You are in Round 2 of a multi-agent debate. You made an independent forecast in Round 1.
Now review the other agents' estimates and decide whether to revise yours.
Be concise (2-4 sentences). Explain why you are or aren't changing your estimate.
End with exactly: **Revised estimate: XX%**`;

    const userMessage = `Market: "${question}"

Your Round 1 estimate: ${(agent.probability * 100).toFixed(1)}%

Other agents' Round 1 estimates:
${otherForecasts}

Should you revise your estimate? Why or why not?`;

    try {
      const content = await completeText({
        task: "debate",
        model: resolveLlmModel("debate", persona?.model),
        maxTokens: 300,
        systemPrompt: system,
        userMessage,
      });

      // Extract revised probability from response
      const match = content.match(/\*?\*?Revised estimate:\s*(\d+(?:\.\d+)?)\s*%\*?\*?/i);
      const revisedProbability = match
        ? Math.max(0, Math.min(1, parseFloat(match[1]) / 100))
        : agent.probability;

      results.push({
        agentId: agent.agentId,
        agentName: agent.agentName,
        originalProbability: agent.probability,
        revisedProbability,
        debateReasoning: content,
      });
    } catch {
      // On failure, keep original estimate
      results.push({
        agentId: agent.agentId,
        agentName: agent.agentName,
        originalProbability: agent.probability,
        revisedProbability: agent.probability,
        debateReasoning: "Debate round failed — keeping original estimate.",
      });
    }
  }

  return results;
}

export async function generateDebateExchange(params: {
  question: string;
  leadAgent: string;
  leadProbability: number;
  leadReasoning: string;
  challenger: AgentPersona;
}): Promise<string> {
  if (Date.now() < providerCooldownUntil) {
    return buildFallbackDebateMessage({
      leadProbability: params.leadProbability,
      reason: providerCooldownReason || "provider cooldown",
    });
  }

  if (!config.llmDebateConfigured) {
    return buildFallbackDebateMessage({
      leadProbability: params.leadProbability,
      reason: getLlmConfigurationError("debate"),
    });
  }

  const system = `${params.challenger.systemPrompt}

You are now in a live debate. Respond in 1-2 crisp sentences.
Challenge weak assumptions, add missing data, or agree if the logic is strong.
End with: Stance: AGREE | DISAGREE | UNCERTAIN`;

  const userMessage = `Market: "${params.question}"
Lead agent (${params.leadAgent}) predicted ${(params.leadProbability * 100).toFixed(0)}%.
Their reasoning (excerpt): ${params.leadReasoning}

Your response:`;

  try {
    const content = await completeText({
      task: "debate",
      model: resolveLlmModel("debate", params.challenger.model),
      maxTokens: 220,
      systemPrompt: system,
      userMessage,
    });

    return content || "Stance: UNCERTAIN";
  } catch (err) {
    const message = extractDebateErrorMessage(err);
    if (shouldEnterCooldown(message)) {
      providerCooldownUntil = Date.now() + DEBATE_PROVIDER_COOLDOWN_MS;
      providerCooldownReason = LOW_CREDIT_REGEX.test(message)
        ? "LLM credits exhausted"
        : "provider rate limited";
      return buildFallbackDebateMessage({
        leadProbability: params.leadProbability,
        reason: providerCooldownReason,
      });
    }
    throw err;
  }
}
