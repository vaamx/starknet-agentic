/**
 * hicecaster forecast <market-id> — Run research + debate + forecast.
 *
 * Uses SSE streaming to show live progress as agents work.
 * Falls back to non-streaming if SSE fails.
 */

import pc from "picocolors";
import { createSpinner } from "../spinner.js";

export interface ForecastOptions {
  marketId: string;
  apiUrl: string;
  verbose: boolean;
}

function wordWrap(text: string, indent = "  ", width = 78): void {
  const words = text.split(" ");
  let line = indent;
  for (const w of words) {
    if (line.length + w.length > width) {
      console.log(pc.dim(line));
      line = indent;
    }
    line += w + " ";
  }
  if (line.trim()) console.log(pc.dim(line));
}

async function streamForecast(opts: ForecastOptions): Promise<boolean> {
  try {
    const res = await fetch(`${opts.apiUrl}/api/multi-predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ marketId: opts.marketId, stream: true }),
    });

    if (!res.ok || !res.body) return false;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) return false;

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = "";
    let phase = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        try {
          const event = JSON.parse(raw) as {
            type?: string;
            phase?: string;
            agent?: string;
            probability?: number;
            confidence?: number;
            reasoning?: string;
            question?: string;
            source?: string;
          };

          // Phase transitions
          if (event.phase && event.phase !== phase) {
            phase = event.phase;
            const label = phase.charAt(0).toUpperCase() + phase.slice(1);
            console.log();
            console.log(pc.bold(pc.cyan(`  [${label}]`)));
          }

          // Research events
          if (event.type === "research" && event.source) {
            process.stdout.write(pc.dim(`  Searching ${event.source}... `));
          }
          if (event.type === "research_done") {
            process.stdout.write(pc.green("done\n"));
          }

          // Individual forecast
          if (event.type === "forecast" && event.agent) {
            const prob = event.probability != null ? `${(event.probability * 100).toFixed(0)}%` : "?";
            const probColor = (event.probability || 0.5) > 0.7 ? pc.green : (event.probability || 0.5) < 0.3 ? pc.red : pc.yellow;
            console.log(`  ${pc.cyan(event.agent.padEnd(16))} ${probColor(prob)}`);
            if (opts.verbose && event.reasoning) {
              console.log(pc.dim(`    ${event.reasoning.slice(0, 100)}`));
            }
          }

          // Debate
          if (event.type === "debate" && event.agent) {
            console.log(`  ${pc.cyan(event.agent)}: ${pc.dim((event.reasoning || "").slice(0, 90))}`);
          }

          // Synthesis (final result)
          if (event.type === "synthesis") {
            console.log();
            console.log(pc.bold("  Synthesis"));
            if (event.probability != null) {
              const p = event.probability;
              const probColor = p > 0.7 ? pc.green : p < 0.3 ? pc.red : pc.yellow;
              console.log(`  Probability: ${probColor(pc.bold(`${(p * 100).toFixed(1)}%`))}`);
            }
            if (event.confidence != null) {
              console.log(`  Confidence:  ${(event.confidence * 100).toFixed(0)}%`);
            }
            if (event.reasoning) {
              console.log();
              wordWrap(event.reasoning);
            }
          }
        } catch {
          // skip unparseable SSE lines
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function batchForecast(opts: ForecastOptions): Promise<void> {
  const spinner = createSpinner("Running forecast");
  spinner.start();

  const res = await fetch(`${opts.apiUrl}/api/multi-predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marketId: opts.marketId, stream: false }),
  });

  if (!res.ok) {
    spinner.stop(pc.red("Failed"));
    const body = await res.text();
    throw new Error(`API returned ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    marketId: string;
    question: string;
    synthesis?: {
      probability: number;
      confidence: number;
      reasoning: string;
    };
    forecasts?: Array<{
      agentId: string;
      probability: number;
      reasoning: string;
    }>;
  };

  spinner.stop("");

  if (data.synthesis) {
    const s = data.synthesis;
    const probColor =
      s.probability > 0.7
        ? pc.green
        : s.probability < 0.3
          ? pc.red
          : pc.yellow;

    console.log(pc.bold("  Synthesis"));
    console.log(
      `  Probability: ${probColor(pc.bold(`${(s.probability * 100).toFixed(1)}%`))}`
    );
    console.log(
      `  Confidence:  ${(s.confidence * 100).toFixed(0)}%`
    );
    console.log();
    wordWrap(s.reasoning);
  }

  if (opts.verbose && data.forecasts) {
    console.log();
    console.log(pc.bold("  Individual forecasts:"));
    for (const f of data.forecasts) {
      console.log(
        `  ${pc.cyan(f.agentId)}: ${(f.probability * 100).toFixed(1)}%`
      );
      if (f.reasoning) {
        console.log(pc.dim(`    ${f.reasoning.slice(0, 120)}`));
      }
    }
  }
}

export async function runForecast(opts: ForecastOptions): Promise<void> {
  console.log(pc.cyan(`Forecasting market ${opts.marketId}...`));

  try {
    // Try streaming first, fall back to batch
    const streamed = await streamForecast(opts);
    if (!streamed) {
      await batchForecast(opts);
    }
  } catch (err) {
    console.error(pc.red("Forecast failed:"), (err as Error).message);
    process.exit(1);
  }
}
