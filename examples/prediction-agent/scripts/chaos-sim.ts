#!/usr/bin/env tsx

import {
  evaluateChaosSlo,
  runDeterministicChaosSimulation,
  type ChaosSlo,
} from "../app/lib/chaos-sim";

function usage(): void {
  console.log(`Usage: tsx scripts/chaos-sim.ts [options]

Deterministic chaos simulation for runtime failover + consensus hardening.

Options:
  --seed <n>                              RNG seed (default: 20260224)
  --ticks <n>                             Tick count (default: 180)
  --outage-rate <0..1>                    Per-region outage probability (default: 0.22)
  --adversarial-rate <0..1>               Adversarial peer share (default: 0.4)
  --max-shift-pct <n>                     Consensus max shift percentage (default: 15)
  --quarantine-secs <n>                   Region quarantine window (default: 600)
  --min-failover-success-rate <0..1>      Optional SLO gate
  --max-consensus-block-rate <0..1>       Optional SLO gate
  --max-consensus-avg-abs-delta-pct <n>   Optional SLO gate
  --timeline <n>                          Print first N timeline rows (default: 0)
  --strict                                Exit 1 when SLO checks fail
  --json                                  Print full JSON payload
  -h, --help                              Show help
`);
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readArg(argv: string[], index: number): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return value;
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    return 0;
  }

  let seed: number | undefined;
  let ticks: number | undefined;
  let outageRate: number | undefined;
  let adversarialRate: number | undefined;
  let maxShiftPct: number | undefined;
  let quarantineSecs: number | undefined;
  let timelineRows = 0;
  let strict = false;
  let asJson = false;

  const slo: ChaosSlo = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    }

    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--json") {
      asJson = true;
      continue;
    }

    if (arg === "--seed") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--seed must be a number");
      seed = parsed;
      i += 1;
      continue;
    }
    if (arg === "--ticks") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--ticks must be a number");
      ticks = parsed;
      i += 1;
      continue;
    }
    if (arg === "--outage-rate") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--outage-rate must be a number");
      outageRate = parsed;
      i += 1;
      continue;
    }
    if (arg === "--adversarial-rate") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--adversarial-rate must be a number");
      adversarialRate = parsed;
      i += 1;
      continue;
    }
    if (arg === "--max-shift-pct") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--max-shift-pct must be a number");
      maxShiftPct = parsed;
      i += 1;
      continue;
    }
    if (arg === "--quarantine-secs") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--quarantine-secs must be a number");
      quarantineSecs = parsed;
      i += 1;
      continue;
    }
    if (arg === "--timeline") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--timeline must be a number");
      timelineRows = Math.max(0, Math.floor(parsed));
      i += 1;
      continue;
    }
    if (arg === "--min-failover-success-rate") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--min-failover-success-rate must be a number");
      slo.minFailoverSuccessRate = parsed;
      i += 1;
      continue;
    }
    if (arg === "--max-consensus-block-rate") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--max-consensus-block-rate must be a number");
      slo.maxConsensusBlockRate = parsed;
      i += 1;
      continue;
    }
    if (arg === "--max-consensus-avg-abs-delta-pct") {
      const parsed = parseNumber(readArg(argv, i));
      if (parsed === null) throw new Error("--max-consensus-avg-abs-delta-pct must be a number");
      slo.maxConsensusAvgAbsDeltaPct = parsed;
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  const result = runDeterministicChaosSimulation({
    seed,
    ticks,
    outageRate,
    adversarialPeerRate: adversarialRate,
    maxShift: typeof maxShiftPct === "number" ? maxShiftPct / 100 : undefined,
    quarantineSecs,
  });

  const hasSloChecks = Object.keys(slo).length > 0;
  const sloResult = hasSloChecks ? evaluateChaosSlo(result, slo) : null;

  if (asJson) {
    const payload =
      timelineRows > 0
        ? { ...result, timeline: result.timeline.slice(0, timelineRows), slo: sloResult }
        : { ...result, slo: sloResult };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("== Chaos Simulation ==");
    console.log(`seed=${result.options.seed} ticks=${result.options.ticks}`);
    console.log(
      `failover: attempts=${result.failover.attempts} succeeded=${result.failover.succeeded} ` +
        `successRate=${(result.failover.successRate * 100).toFixed(2)}% noHealthyRegion=${result.failover.noHealthyRegion}`
    );
    console.log(
      `consensus: applied=${result.consensus.applied}/${result.consensus.samples} ` +
        `blocked=${result.consensus.blocked} clamped=${result.consensus.clamped} ` +
        `avgAbsDeltaPct=${result.consensus.avgAbsDeltaPct.toFixed(2)}`
    );
    if (timelineRows > 0) {
      console.log("");
      console.log("timeline:");
      for (const row of result.timeline.slice(0, timelineRows)) {
        console.log(
          `tick=${row.tick} region=${row.region} outages=${row.outageRegions.join(",") || "-"} ` +
            `failover=${row.failoverOccurred ? row.failoverTarget ?? "yes" : "no"} ` +
            `consensus=${row.consensusApplied ? "applied" : "blocked"} ` +
            `guardrail=${row.consensusGuardrail ?? "-"} delta=${row.consensusDeltaPct.toFixed(2)}pp`
        );
      }
    }
    if (sloResult) {
      console.log("");
      console.log(`slo: ${sloResult.ok ? "pass" : "fail"}`);
      for (const check of sloResult.checks) {
        console.log(
          `- ${check.name}: ${check.ok ? "ok" : "fail"} (actual=${check.actual}, expected=${check.expected})`
        );
      }
    }
  }

  if (strict && sloResult && !sloResult.ok) {
    return 1;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (err: any) {
  console.error(`chaos-sim error: ${err?.message ?? String(err)}`);
  process.exitCode = 1;
}
