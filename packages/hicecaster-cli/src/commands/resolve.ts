/**
 * hicecaster resolve <id> — Trigger resolution oracle for a market.
 */

import pc from "picocolors";
import { createSpinner } from "../spinner.js";

export interface ResolveOptions {
  marketId: string;
  apiUrl: string;
}

export async function runResolve(opts: ResolveOptions): Promise<void> {
  console.log(pc.cyan(`Resolving market ${opts.marketId}...`));
  console.log();

  const spinner = createSpinner("Running oracle");
  spinner.start();

  try {
    const res = await fetch(
      `${opts.apiUrl}/api/resolution/${opts.marketId}/resolve`,
      { method: "POST" }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API returned ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      status: string;
      outcome?: string;
      confidence?: number;
      reasoning?: string;
      attempt?: number;
    };

    spinner.stop("");

    if (data.status === "resolved") {
      const outcomeColor = data.outcome === "YES" ? pc.green : data.outcome === "NO" ? pc.red : pc.yellow;
      console.log(`  Outcome:    ${outcomeColor(pc.bold(data.outcome || "UNKNOWN"))}`);
      if (data.confidence != null) {
        console.log(`  Confidence: ${(data.confidence * 100).toFixed(0)}%`);
      }
    } else if (data.status === "pending") {
      console.log(pc.yellow(`  Status: pending (attempt ${data.attempt || "?"})`));
      console.log(pc.dim("  Oracle needs more data or confidence is too low."));
      console.log(pc.dim("  Try again later or wait for auto-resolution."));
    } else {
      console.log(pc.dim(`  Status: ${data.status}`));
    }

    if (data.reasoning) {
      console.log();
      console.log(pc.dim("  Reasoning:"));
      const words = data.reasoning.split(" ");
      let line = "  ";
      for (const w of words) {
        if (line.length + w.length > 78) {
          console.log(pc.dim(line));
          line = "  ";
        }
        line += w + " ";
      }
      if (line.trim()) console.log(pc.dim(line));
    }
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(pc.red("Resolution failed:"), (err as Error).message);
    process.exit(1);
  }
}
