/**
 * OpenForecaster — Prompt builder and response parser for the OpenForecaster-8B model.
 *
 * OpenForecaster-8B is a Qwen3-8B fine-tuned via GRPO for calibrated probability
 * estimation. It matches 100B+ models on forecasting benchmarks (Brier score).
 *
 * Prompt format: structured question + optional retrieved articles → model produces
 * chain-of-thought reasoning + <answer> and <probability> XML tags.
 *
 * Ensemble mode: run N generations at temp=0.6, average probabilities for better
 * calibration (matches the model's eval methodology from arXiv:2512.25070).
 *
 * @see https://huggingface.co/nikhilchandak/OpenForecaster-8B
 * @see https://arxiv.org/abs/2512.25070
 */

import { config } from "./config";
import { extractProbability } from "./agent-forecaster";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenForecasterResult {
  reasoning: string;
  probability: number;
  answer: string | null;
  /** Number of ensemble runs that produced a valid probability */
  validRuns: number;
  /** All individual probabilities from ensemble runs */
  rawProbabilities: number[];
}

// ── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build an OpenForecaster-compatible prompt from a market question and research data.
 *
 * The prompt follows the format from the OpenForecaster training pipeline:
 * - Question title
 * - Background / research articles (time-filtered)
 * - Resolution criteria
 * - Answer type (binary for YES/NO markets)
 * - Instructions requesting <answer> + <probability> XML tags
 */
export function buildOpenForecasterPrompt(
  question: string,
  opts: {
    researchBrief?: string;
    resolutionCriteria?: string;
    currentMarketProb?: number;
    timeUntilResolution?: string;
    agentPredictions?: { agent: string; prob: number; brier: number }[];
  } = {}
): { system: string; user: string } {
  const system = `You are a calibrated forecaster. Your task is to predict the probability of future events. Think step by step, consider base rates and specific evidence, then provide your answer.

Output format:
- Reason through the question carefully
- Put your predicted answer in <answer> </answer> tags
- Put your probability estimate (0.00-1.00) in <probability> </probability> tags
- For binary YES/NO questions, the probability represents the chance of YES`;

  let background = "";

  if (opts.researchBrief) {
    // Split research into article-style passages (OpenForecaster was trained with
    // up to 5 retrieved news chunks as context)
    const chunks = splitIntoArticles(opts.researchBrief, 5);
    for (let i = 0; i < chunks.length; i++) {
      background += `\nArticle ${i + 1}:\n${chunks[i]}\n`;
    }
  }

  if (opts.currentMarketProb !== undefined) {
    background += `\nCurrent market implied probability: ${(opts.currentMarketProb * 100).toFixed(1)}%`;
  }

  if (opts.timeUntilResolution) {
    background += `\nTime until resolution: ${opts.timeUntilResolution}`;
  }

  if (opts.agentPredictions?.length) {
    background += "\nOther forecaster predictions:";
    for (const p of opts.agentPredictions) {
      background += `\n  - Forecaster ${p.agent}: ${(p.prob * 100).toFixed(0)}% (Brier: ${p.brier.toFixed(3)})`;
    }
  }

  let user = `Question: ${question}`;
  if (background.trim()) {
    user += `\nBackground: ${background.trim()}`;
  }
  if (opts.resolutionCriteria) {
    user += `\nResolution Criteria: ${opts.resolutionCriteria}`;
  }
  user += `\nAnswer Type: binary (YES or NO)`;

  return { system, user };
}

// ── Response parser ──────────────────────────────────────────────────────────

/**
 * Parse OpenForecaster's response for <answer> and <probability> XML tags.
 * Falls back to the standard "**My estimate: XX%**" regex if XML tags are missing
 * (in case the model was prompted with a non-OpenForecaster prompt).
 */
export function parseOpenForecasterResponse(text: string): {
  answer: string | null;
  probability: number | null;
} {
  // Extract <answer>...</answer>
  const answerMatch = text.match(/<answer>\s*([\s\S]*?)\s*<\/answer>/i);
  const answer = answerMatch ? answerMatch[1].trim() : null;

  // Extract <probability>...</probability>
  const probMatch = text.match(/<probability>\s*([\d.]+)\s*<\/probability>/i);
  let probability: number | null = null;

  if (probMatch) {
    const raw = parseFloat(probMatch[1]);
    if (Number.isFinite(raw)) {
      // OpenForecaster outputs 0.00-1.00 scale
      probability = raw > 1 ? raw / 100 : raw;
      probability = Math.max(0, Math.min(1, probability));
    }
  }

  // Fallback: use the standard "XX%" regex parser
  if (probability === null) {
    probability = extractProbability(text);
  }

  return { answer, probability };
}

// ── Ensemble forecast ────────────────────────────────────────────────────────

/**
 * Run N independent forecasts via Ollama and average probabilities.
 *
 * This matches OpenForecaster's evaluation methodology: multiple generations
 * at temperature=0.6, averaged for better calibration. Research shows this
 * reduces Brier score variance significantly.
 *
 * @param question - The prediction market question
 * @param opts - Context for prompt building
 * @param n - Number of ensemble runs (default from config, fallback 3)
 * @returns Averaged forecast result
 */
export async function ensembleForecast(
  question: string,
  opts: {
    researchBrief?: string;
    resolutionCriteria?: string;
    currentMarketProb?: number;
    timeUntilResolution?: string;
    agentPredictions?: { agent: string; prob: number; brier: number }[];
    model?: string;
  } = {},
  n?: number
): Promise<OpenForecasterResult> {
  const ensembleCount = n ?? config.openForecasterEnsembleCount;
  const model = opts.model ?? config.openForecasterModel;
  const temperature = config.openForecasterTemperature;

  const { system, user } = buildOpenForecasterPrompt(question, opts);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.ollamaApiKey) {
    headers.Authorization = `Bearer ${config.ollamaApiKey}`;
  }

  // Fire all ensemble runs in parallel
  const promises = Array.from({ length: ensembleCount }, () =>
    fetchOllamaChat(config.ollamaBaseUrl, model, system, user, temperature, headers)
  );

  const settled = await Promise.allSettled(promises);

  const validResults: { answer: string | null; probability: number; reasoning: string }[] = [];
  const rawProbabilities: number[] = [];

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const text = result.value;
    const parsed = parseOpenForecasterResponse(text);
    if (parsed.probability !== null) {
      validResults.push({
        answer: parsed.answer,
        probability: parsed.probability,
        reasoning: text,
      });
      rawProbabilities.push(parsed.probability);
    }
  }

  if (validResults.length === 0) {
    // All runs failed — return a neutral fallback
    return {
      reasoning: "OpenForecaster ensemble produced no valid probabilities. Returning neutral estimate.",
      probability: opts.currentMarketProb ?? 0.5,
      answer: null,
      validRuns: 0,
      rawProbabilities: [],
    };
  }

  // Average probabilities
  const avgProbability =
    rawProbabilities.reduce((sum, p) => sum + p, 0) / rawProbabilities.length;

  // Pick the reasoning from the run closest to the average (most representative)
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < validResults.length; i++) {
    const dist = Math.abs(validResults[i].probability - avgProbability);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  const bestResult = validResults[bestIdx];

  // Append ensemble metadata to reasoning
  const ensembleSuffix =
    `\n\n--- Ensemble (${validResults.length}/${ensembleCount} valid runs) ---\n` +
    `Individual estimates: ${rawProbabilities.map((p) => `${(p * 100).toFixed(1)}%`).join(", ")}\n` +
    `Averaged estimate: ${(avgProbability * 100).toFixed(1)}%`;

  return {
    reasoning: bestResult.reasoning + ensembleSuffix,
    probability: avgProbability,
    answer: bestResult.answer,
    validRuns: validResults.length,
    rawProbabilities,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split research brief into up to `maxChunks` article-like passages.
 * Uses double-newline or "---" separators when available; otherwise
 * splits evenly by character count.
 */
function splitIntoArticles(brief: string, maxChunks: number): string[] {
  // Try splitting on common separators
  const separators = brief.split(/\n{2,}|---+/);
  const nonEmpty = separators.map((s) => s.trim()).filter((s) => s.length > 30);

  if (nonEmpty.length > 0) {
    return nonEmpty.slice(0, maxChunks);
  }

  // Fallback: split evenly
  const chunkSize = Math.ceil(brief.length / maxChunks);
  const chunks: string[] = [];
  for (let i = 0; i < brief.length && chunks.length < maxChunks; i += chunkSize) {
    const chunk = brief.slice(i, i + chunkSize).trim();
    if (chunk.length > 0) chunks.push(chunk);
  }
  return chunks;
}

/**
 * Call Ollama /api/chat endpoint. Returns the raw response text.
 */
async function fetchOllamaChat(
  baseUrl: string,
  model: string,
  system: string,
  user: string,
  temperature: number,
  headers: Record<string, string>
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      options: {
        temperature,
        num_predict: 4096,
        top_p: 0.95,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const payload = await response.json();
  const text =
    payload?.message?.content ??
    payload?.response ??
    payload?.output?.text ??
    "";

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Ollama response missing content");
  }

  return text.trim();
}

/**
 * Check whether the given model string looks like an OpenForecaster model.
 * Used by the forecaster to decide whether to use the OpenForecaster prompt
 * format vs the standard superforecaster prompt.
 */
export function isOpenForecasterModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("openforecaster") || normalized.includes("open-forecaster");
}
