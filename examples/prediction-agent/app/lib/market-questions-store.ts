/**
 * Dedicated Upstash Redis hash for market questions.
 *
 * Solves: Vercel ephemeral FS means SQLite + in-memory maps lose question
 * text on cold starts. This uses a separate Redis hash so questions survive
 * across deploys and cold starts without being contaminated by placeholder
 * "Market #X" values from the main state store.
 *
 * Key: starknet-agentic:market-questions:v1  (Redis HASH)
 * Fields: market ID (string) → question text (string)
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH_KEY =
  process.env.MARKET_QUESTIONS_UPSTASH_KEY ||
  "starknet-agentic:market-questions:v1";

const IS_CONFIGURED = !!UPSTASH_URL && !!UPSTASH_TOKEN;

const PLACEHOLDER_RE = /^Market #\d+$/;

function isPlaceholder(q: string): boolean {
  return !q || PLACEHOLDER_RE.test(q.trim());
}

async function upstashCommand(
  command: string[]
): Promise<any> {
  if (!IS_CONFIGURED) return null;

  const res = await fetch(`${UPSTASH_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const payload = await res.json();
  return payload?.result ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a real (non-placeholder) question to Upstash.
 * No-ops if Upstash is not configured or question is a placeholder.
 */
export async function persistQuestion(
  marketId: number,
  question: string
): Promise<void> {
  if (!IS_CONFIGURED || isPlaceholder(question)) return;
  try {
    await upstashCommand(["HSET", HASH_KEY, String(marketId), question.trim()]);
  } catch {
    // best-effort
  }
}

/**
 * Persist multiple questions at once (HMSET).
 */
export async function persistQuestionsBatch(
  entries: Array<{ id: number; question: string }>
): Promise<void> {
  if (!IS_CONFIGURED) return;
  const args: string[] = ["HMSET", HASH_KEY];
  for (const { id, question } of entries) {
    if (!isPlaceholder(question)) {
      args.push(String(id), question.trim());
    }
  }
  if (args.length <= 2) return; // nothing to write
  try {
    await upstashCommand(args);
  } catch {
    // best-effort
  }
}

/**
 * Load all questions from Upstash.
 * Returns a map of marketId → question text (only real questions, no placeholders).
 */
export async function loadAllQuestions(): Promise<Record<number, string>> {
  if (!IS_CONFIGURED) return {};
  try {
    const result = await upstashCommand(["HGETALL", HASH_KEY]);
    if (!result || typeof result !== "object") return {};

    // HGETALL returns alternating [field, value, field, value, ...]
    const out: Record<number, string> = {};
    if (Array.isArray(result)) {
      for (let i = 0; i < result.length - 1; i += 2) {
        const id = Number(result[i]);
        const question = String(result[i + 1]);
        if (Number.isFinite(id) && !isPlaceholder(question)) {
          out[id] = question;
        }
      }
    } else {
      // Some Upstash SDK versions return an object
      for (const [key, value] of Object.entries(result)) {
        const id = Number(key);
        const question = String(value);
        if (Number.isFinite(id) && !isPlaceholder(question)) {
          out[id] = question;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Get a single question from Upstash.
 */
export async function getQuestion(
  marketId: number
): Promise<string | null> {
  if (!IS_CONFIGURED) return null;
  try {
    const result = await upstashCommand([
      "HGET",
      HASH_KEY,
      String(marketId),
    ]);
    if (typeof result === "string" && !isPlaceholder(result)) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return IS_CONFIGURED;
}
