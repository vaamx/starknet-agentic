import { describe, expect, it } from "vitest";
import {
  buildForecastSkillPlan,
  formatForecastSkillPlan,
} from "./forecast-skills";
import { getPersona } from "./agent-personas";

describe("forecast skill planning", () => {
  it("returns default skills and source recommendations", () => {
    const persona = getPersona("alpha");
    if (!persona) throw new Error("missing test persona");

    const plan = buildForecastSkillPlan(
      "Will ETH surpass $5,000 by December 2026?",
      persona
    );

    expect(plan.skills.length).toBeGreaterThan(0);
    expect(plan.recommendedSources.length).toBeGreaterThan(0);
    expect(plan.recommendedSources).toContain("polymarket");
  });

  it("adds momentum skill for quant personas", () => {
    const persona = getPersona("beta");
    if (!persona) throw new Error("missing test persona");

    const plan = buildForecastSkillPlan(
      "Will BTC market cap reach a new all-time high this year?",
      persona
    );

    expect(plan.skills.some((skill) => skill.id === "onchain_momentum")).toBe(
      true
    );
  });

  it("formats plan for prompt injection", () => {
    const persona = getPersona("delta");
    if (!persona) throw new Error("missing test persona");
    const plan = buildForecastSkillPlan(
      "Will a major protocol upgrade pass governance vote this quarter?",
      persona
    );

    const formatted = formatForecastSkillPlan(plan);
    expect(formatted).toContain("Forecast Skill Plan");
    expect(formatted).toContain("Recommended sources:");
  });
});
