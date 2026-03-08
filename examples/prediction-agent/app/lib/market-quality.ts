import { categorizeMarket, type MarketCategory } from "./categories";

export interface MarketQuestionReview {
  normalizedQuestion: string;
  score: number;
  issues: string[];
  warnings: string[];
  isBinary: boolean;
  hasTimeBound: boolean;
  categoryHint: MarketCategory;
}

const AMBIGUOUS_TERMS = [
  "soon",
  "eventually",
  "significant",
  "major",
  "massive",
  "big",
  "small",
  "high",
  "low",
  "successful",
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function detectCategory(question: string): MarketCategory {
  return categorizeMarket(question);
}

export function reviewMarketQuestion(question: string): MarketQuestionReview {
  const normalizedQuestion = question.trim().replace(/\s+/g, " ");
  const lower = normalizedQuestion.toLowerCase();
  const issues: string[] = [];
  const warnings: string[] = [];

  const isBinary =
    /^will\b/i.test(normalizedQuestion) ||
    /\b(yes|no)\b/i.test(normalizedQuestion);
  const hasQuestionMark = normalizedQuestion.endsWith("?");
  const hasTimeBound =
    /\b(by|before|after|on|during|within)\b/i.test(normalizedQuestion) ||
    /\b20\d{2}\b/.test(normalizedQuestion) ||
    /\b(q[1-4]|quarter|month|week|day|today|tomorrow)\b/i.test(
      normalizedQuestion
    );

  if (normalizedQuestion.length < 20) {
    issues.push("Question is too short; include explicit measurable criteria.");
  }
  if (normalizedQuestion.length > 220) {
    warnings.push("Question is long; shorten to reduce interpretation risk.");
  }
  if (!isBinary) {
    issues.push("Question should be binary and resolve to YES/NO.");
  }
  if (!hasQuestionMark) {
    warnings.push("End with a '?' to improve market readability.");
  }
  if (!hasTimeBound) {
    issues.push("Question needs a clear time bound for objective resolution.");
  }

  const ambiguous = AMBIGUOUS_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(lower)
  );
  if (ambiguous.length > 0) {
    warnings.push(
      `Ambiguous wording detected: ${ambiguous.join(
        ", "
      )}. Use measurable thresholds.`
    );
  }

  let score = 100;
  score -= issues.length * 18;
  score -= warnings.length * 7;
  if (isBinary) score += 6;
  if (hasTimeBound) score += 8;
  if (normalizedQuestion.length >= 35 && normalizedQuestion.length <= 140) {
    score += 6;
  }

  return {
    normalizedQuestion,
    score: clampScore(score),
    issues,
    warnings,
    isBinary,
    hasTimeBound,
    categoryHint: detectCategory(normalizedQuestion),
  };
}
