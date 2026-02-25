import { describe, expect, it } from "vitest";
import {
  assessResearchCoverage,
  checkResearchGate,
  mergeResearchCoverage,
  type ResearchCoverage,
} from "./research-quality";
import type { DataSourceResult } from "./data-sources";

function makeResult(source: string, count: number): DataSourceResult {
  return {
    source,
    query: "q",
    timestamp: Date.now(),
    data: Array.from({ length: count }, (_, i) => ({
      label: `${source}-${i}`,
      value: "v",
    })),
    summary: count > 0 ? "ok" : "empty",
  };
}

describe("research-quality", () => {
  it("assesses source coverage and evidence points", () => {
    const coverage = assessResearchCoverage([
      makeResult("news", 3),
      makeResult("social", 0),
      makeResult("web", 2),
    ]);

    expect(coverage.requestedSources).toBe(3);
    expect(coverage.nonEmptySources).toBe(2);
    expect(coverage.totalDataPoints).toBe(5);
    expect(coverage.emptySourceNames).toEqual(["social"]);
    expect(coverage.populatedSourceNames).toEqual(["news", "web"]);
  });

  it("fails gate on low source coverage", () => {
    const coverage: ResearchCoverage = {
      requestedSources: 3,
      nonEmptySources: 1,
      totalDataPoints: 10,
      emptySourceNames: ["news", "social"],
      populatedSourceNames: ["web"],
    };
    const gate = checkResearchGate(coverage, 2, 4);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("source coverage");
  });

  it("fails gate on low evidence points", () => {
    const coverage: ResearchCoverage = {
      requestedSources: 3,
      nonEmptySources: 3,
      totalDataPoints: 2,
      emptySourceNames: [],
      populatedSourceNames: ["news", "social", "web"],
    };
    const gate = checkResearchGate(coverage, 2, 4);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("evidence points");
  });

  it("passes gate with enough evidence", () => {
    const coverage = assessResearchCoverage([
      makeResult("news", 2),
      makeResult("x", 2),
      makeResult("web", 2),
    ]);
    const gate = checkResearchGate(coverage, 2, 4);
    expect(gate.ok).toBe(true);
  });

  it("merges tool evidence into source and point coverage", () => {
    const base = assessResearchCoverage([
      makeResult("news", 2),
      makeResult("social", 0),
    ]);

    const merged = mergeResearchCoverage(base, [
      { source: "social", dataPoints: 3, isError: false },
      { source: "web", dataPoints: 2, isError: false },
      { source: "onchain", dataPoints: 0, isError: true },
    ]);

    expect(merged.requestedSources).toBe(4);
    expect(merged.nonEmptySources).toBe(3);
    expect(merged.totalDataPoints).toBe(7);
    expect(merged.populatedSourceNames.sort()).toEqual(["news", "social", "web"]);
    expect(merged.emptySourceNames.sort()).toEqual(["onchain"]);
  });
});
