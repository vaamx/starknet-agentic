import Anthropic from "@anthropic-ai/sdk";
import type { AgentPersona } from "./agent-personas";
import { AGENT_PERSONAS } from "./agent-personas";

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

/**
 * Run a full debate round: each agent reviews the Round 1 results from all
 * other agents and may revise their own probability estimate.
 */
export async function runDebateRound(
  round1Results: Round1Result[],
  question: string,
  systemPrompts: Record<string, string>
): Promise<DebateResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const client = new Anthropic({ apiKey });
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
      const response = await client.messages.create({
        model: persona?.model || "claude-sonnet-4-5-20250929",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      const content = response.content
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const client = new Anthropic({ apiKey });

  const system = `${params.challenger.systemPrompt}

You are now in a live debate. Respond in 1-2 crisp sentences.
Challenge weak assumptions, add missing data, or agree if the logic is strong.
End with: Stance: AGREE | DISAGREE | UNCERTAIN`;

  const userMessage = `Market: "${params.question}"
Lead agent (${params.leadAgent}) predicted ${(params.leadProbability * 100).toFixed(0)}%.
Their reasoning (excerpt): ${params.leadReasoning}

Your response:`;

  const response = await client.messages.create({
    model: params.challenger.model || "claude-sonnet-4-5-20250929",
    max_tokens: 220,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const content = response.content
    .map((c: any) => (c.type === "text" ? c.text : ""))
    .join("")
    .trim();

  return content || "Stance: UNCERTAIN";
}
