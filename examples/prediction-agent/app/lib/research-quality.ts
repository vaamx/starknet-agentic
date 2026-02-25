import type { DataSourceResult } from "./data-sources";

export interface ResearchCoverage {
  requestedSources: number;
  nonEmptySources: number;
  totalDataPoints: number;
  emptySourceNames: string[];
  populatedSourceNames: string[];
}

export interface ResearchGateResult {
  ok: boolean;
  reason: string;
}

export interface ToolEvidence {
  source: string;
  dataPoints: number;
  isError?: boolean;
}

export function assessResearchCoverage(
  results: DataSourceResult[]
): ResearchCoverage {
  const safeResults = Array.isArray(results) ? results : [];
  const populated = safeResults.filter((r) => (r.data?.length ?? 0) > 0);
  const empty = safeResults.filter((r) => (r.data?.length ?? 0) === 0);

  return {
    requestedSources: safeResults.length,
    nonEmptySources: populated.length,
    totalDataPoints: safeResults.reduce(
      (sum, r) => sum + (Array.isArray(r.data) ? r.data.length : 0),
      0
    ),
    emptySourceNames: empty.map((r) => r.source),
    populatedSourceNames: populated.map((r) => r.source),
  };
}

export function mergeResearchCoverage(
  base: ResearchCoverage,
  toolEvidence: ToolEvidence[]
): ResearchCoverage {
  const safeEvidence = Array.isArray(toolEvidence) ? toolEvidence : [];
  const populated = new Set(base.populatedSourceNames);
  const empty = new Set(base.emptySourceNames);
  const requested = new Set([...base.populatedSourceNames, ...base.emptySourceNames]);
  let totalDataPoints = base.totalDataPoints;

  for (const evidence of safeEvidence) {
    const source = String(evidence.source || "").trim();
    if (!source) continue;
    requested.add(source);

    if (evidence.isError) {
      if (!populated.has(source)) {
        empty.add(source);
      }
      continue;
    }

    const points = Number.isFinite(evidence.dataPoints)
      ? Math.max(0, evidence.dataPoints)
      : 0;

    if (points > 0) {
      totalDataPoints += points;
      populated.add(source);
      empty.delete(source);
    } else if (!populated.has(source)) {
      empty.add(source);
    }
  }

  return {
    requestedSources: requested.size,
    nonEmptySources: populated.size,
    totalDataPoints,
    emptySourceNames: [...empty],
    populatedSourceNames: [...populated],
  };
}

export function checkResearchGate(
  coverage: ResearchCoverage,
  minSources: number,
  minPoints: number
): ResearchGateResult {
  if (coverage.nonEmptySources < minSources) {
    return {
      ok: false,
      reason:
        `insufficient source coverage (${coverage.nonEmptySources}/${minSources})`,
    };
  }

  if (coverage.totalDataPoints < minPoints) {
    return {
      ok: false,
      reason:
        `insufficient evidence points (${coverage.totalDataPoints}/${minPoints})`,
    };
  }

  return { ok: true, reason: "sufficient evidence" };
}
