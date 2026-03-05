import type { DataSourceName } from "./data-sources/index";
import type { AgentPersona } from "./agent-personas";

export interface ForecastSkill {
  id: string;
  name: string;
  description: string;
  triggers: RegExp;
  recommendedSources: DataSourceName[];
}

export interface ForecastSkillPlan {
  skills: ForecastSkill[];
  recommendedSources: DataSourceName[];
  cautionFlags: string[];
}

const FORECAST_SKILLS: ForecastSkill[] = [
  {
    id: "base_rate_decomposition",
    name: "Base-Rate Decomposition",
    description:
      "Start from historical prior probabilities before reacting to narratives.",
    triggers: /will|by|before|after|reach|hit|surpass|pass|win|resolve/i,
    recommendedSources: ["polymarket", "news"],
  },
  {
    id: "onchain_momentum",
    name: "On-Chain Momentum",
    description:
      "Weight recent network and market momentum with time-decayed signals.",
    triggers: /eth|btc|strk|crypto|defi|tvl|market|token|staking|yield/i,
    recommendedSources: ["coingecko", "polymarket", "social"],
  },
  {
    id: "event_catalyst_map",
    name: "Catalyst Mapping",
    description:
      "Enumerate concrete catalysts and blockers with explicit probability impact.",
    triggers: /launch|upgrade|vote|bill|election|etf|partnership|release/i,
    recommendedSources: ["news", "social"],
  },
  {
    id: "scenario_tree",
    name: "Scenario Tree",
    description:
      "Build bear/base/bull scenario paths and map each to an explicit estimate.",
    triggers: /price|adoption|growth|decline|surge|recession|regulation/i,
    recommendedSources: ["polymarket", "coingecko", "news"],
  },
  {
    id: "disconfirming_evidence",
    name: "Disconfirming Evidence",
    description:
      "Force a search for evidence that would invalidate the current thesis.",
    triggers: /risk|uncertainty|regulation|ban|security|exploit|hack/i,
    recommendedSources: ["news", "social"],
  },
];

const DEFAULT_SKILL_IDS = [
  "base_rate_decomposition",
  "scenario_tree",
  "disconfirming_evidence",
];

function dedupeSources(sources: DataSourceName[]): DataSourceName[] {
  return Array.from(new Set(sources));
}

function hasSkill(plan: ForecastSkill[], id: string): boolean {
  return plan.some((skill) => skill.id === id);
}

export function buildForecastSkillPlan(
  question: string,
  persona: AgentPersona
): ForecastSkillPlan {
  const matched = FORECAST_SKILLS.filter((skill) =>
    skill.triggers.test(question)
  );

  const seeded: ForecastSkill[] = [...matched];
  for (const id of DEFAULT_SKILL_IDS) {
    const baseSkill = FORECAST_SKILLS.find((skill) => skill.id === id);
    if (baseSkill && !hasSkill(seeded, id)) {
      seeded.push(baseSkill);
    }
  }

  if (
    /quant|market-maker|trader/i.test(persona.agentType) &&
    !hasSkill(seeded, "onchain_momentum")
  ) {
    const momentum = FORECAST_SKILLS.find(
      (skill) => skill.id === "onchain_momentum"
    );
    if (momentum) seeded.push(momentum);
  }

  const recommendedSources = dedupeSources(
    seeded.flatMap((skill) => skill.recommendedSources)
  );

  const cautionFlags: string[] = [];
  if (!recommendedSources.includes("polymarket")) {
    cautionFlags.push("No cross-market odds input in plan.");
  }
  if (!recommendedSources.includes("news")) {
    cautionFlags.push("No event feed input in plan.");
  }
  if (recommendedSources.length <= 2) {
    cautionFlags.push("Low source diversity; confidence should be discounted.");
  }

  return {
    skills: seeded,
    recommendedSources,
    cautionFlags,
  };
}

export function formatForecastSkillPlan(plan: ForecastSkillPlan): string {
  const skillLines = plan.skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");
  const sourceLine = `Recommended sources: ${plan.recommendedSources.join(", ")}`;
  const cautionLine =
    plan.cautionFlags.length > 0
      ? `Cautions: ${plan.cautionFlags.join(" ")}`
      : "Cautions: none";

  return `## Forecast Skill Plan\n${skillLines}\n${sourceLine}\n${cautionLine}`;
}
