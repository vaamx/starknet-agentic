#!/usr/bin/env node

/**
 * Deployment smoke checks for prediction-agent.
 *
 * Validates key launch endpoints against a running deployment.
 */

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SSE_PREVIEW_TIMEOUT_MS = 25_000;

function usage() {
  console.log(`Usage: node scripts/smoke-deployed.mjs [options]

Options:
  --base-url <url>               Base app URL (default: ${DEFAULT_BASE_URL})
  --heartbeat-secret <secret>    Heartbeat secret (fallback: HEARTBEAT_SECRET env)
  --market-id <id>               Explicit market ID for /api/predict
  --skip-predict                 Skip /api/predict SSE smoke call
  --strict                       Treat warnings as failures (exit 1)
  --timeout-ms <ms>              Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --sse-timeout-ms <ms>          SSE preview read timeout (default: ${DEFAULT_SSE_PREVIEW_TIMEOUT_MS})
  -h, --help                     Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    baseUrl: DEFAULT_BASE_URL,
    heartbeatSecret: process.env.HEARTBEAT_SECRET || "",
    marketId: null,
    skipPredict: false,
    strict: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sseTimeoutMs: DEFAULT_SSE_PREVIEW_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--":
        break;
      case "--base-url":
        if (!argv[i + 1]) throw new Error("Missing value for --base-url");
        opts.baseUrl = argv[++i];
        break;
      case "--heartbeat-secret":
        if (!argv[i + 1]) throw new Error("Missing value for --heartbeat-secret");
        opts.heartbeatSecret = argv[++i];
        break;
      case "--market-id": {
        const raw = argv[++i];
        if (!raw) throw new Error("Missing value for --market-id");
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--market-id must be a positive integer");
        }
        opts.marketId = parsed;
        break;
      }
      case "--skip-predict":
        opts.skipPredict = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--timeout-ms": {
        const raw = argv[++i];
        const parsed = Number.parseInt(raw || "", 10);
        if (!Number.isInteger(parsed) || parsed < 1000) {
          throw new Error("--timeout-ms must be an integer >= 1000");
        }
        opts.timeoutMs = parsed;
        break;
      }
      case "--sse-timeout-ms": {
        const raw = argv[++i];
        const parsed = Number.parseInt(raw || "", 10);
        if (!Number.isInteger(parsed) || parsed < 1000) {
          throw new Error("--sse-timeout-ms must be an integer >= 1000");
        }
        opts.sseTimeoutMs = parsed;
        break;
      }
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  try {
    // Validate URL shape early.
    const parsed = new URL(opts.baseUrl);
    opts.baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid --base-url: ${opts.baseUrl}`);
  }

  return opts;
}

function endpoint(baseUrl, pathname) {
  return `${baseUrl}${pathname}`;
}

function truncate(input, max = 280) {
  if (!input) return "";
  const singleLine = input.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max - 3)}...`;
}

async function request(pathname, opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await fetch(endpoint(opts.baseUrl, pathname), {
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      return { response, contentType, text: "", json: null };
    }

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { response, contentType, text, json };
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
      throw new Error(`${pathname} timed out after ${opts.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSsePreview(response, sseTimeoutMs) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + sseTimeoutMs;
  let preview = "";

  try {
    while (Date.now() < deadline && preview.length < 4096) {
      const remaining = Math.max(1, deadline - Date.now());
      const readPromise = reader.read();
      const read = await Promise.race([
        readPromise,
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ timeout: true }),
            Math.min(remaining, 3000),
          );
        }),
      ]);

      if (read && typeof read === "object" && "timeout" in read) {
        try {
          await reader.cancel("SSE preview timeout");
        } catch {
          // Ignore cancel errors.
        }
        try {
          await readPromise;
        } catch {
          // Ignore read errors after cancellation.
        }
        break;
      }

      if (!read || typeof read !== "object" || !("done" in read)) {
        break;
      }

      if (read.done) break;
      preview += decoder.decode(read.value, { stream: true });

      if (preview.includes("[DONE]")) break;
      if (preview.includes('"type":"result"')) break;
      if (preview.includes('"type":"error"')) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancel errors.
    }
  }

  return preview;
}

function makeRecorder() {
  const results = [];

  function push(level, check, detail) {
    results.push({ level, check, detail });
    const icon = level === "pass" ? "[PASS]" : level === "warn" ? "[WARN]" : "[FAIL]";
    console.log(`${icon} ${check}${detail ? `: ${detail}` : ""}`);
  }

  return {
    pass: (check, detail = "") => push("pass", check, detail),
    warn: (check, detail = "") => push("warn", check, detail),
    fail: (check, detail = "") => push("fail", check, detail),
    summary: () => {
      const pass = results.filter((r) => r.level === "pass").length;
      const warn = results.filter((r) => r.level === "warn").length;
      const fail = results.filter((r) => r.level === "fail").length;
      return { pass, warn, fail, results };
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rec = makeRecorder();

  console.log("== Prediction Agent Deployed Smoke Check ==");
  console.log(`Base URL: ${opts.baseUrl}`);
  console.log(`Strict mode: ${opts.strict ? "on" : "off"}`);
  console.log("");

  let marketsPayload = null;

  // 1) Health
  try {
    const { response, json, text } = await request("/api/health", opts);
    if (response.status !== 200) {
      rec.fail("GET /api/health", `HTTP ${response.status} ${truncate(text)}`);
    } else if (!json || typeof json.status !== "string") {
      rec.fail("GET /api/health", "Missing health status payload");
    } else if (json.status === "unhealthy") {
      rec.fail("GET /api/health", "status=unhealthy");
    } else if (json.status === "degraded") {
      rec.warn("GET /api/health", "status=degraded");
    } else {
      rec.pass("GET /api/health", `status=${json.status}`);
    }
  } catch (err) {
    rec.fail("GET /api/health", String(err));
  }

  // 2) Status
  try {
    const { response, json, text } = await request("/api/status", opts);
    if (response.status !== 200) {
      rec.fail("GET /api/status", `HTTP ${response.status} ${truncate(text)}`);
    } else if (!json || typeof json.ok !== "boolean") {
      rec.fail("GET /api/status", "Unexpected response shape");
    } else if (!json.ok) {
      rec.warn("GET /api/status", "ok=false (agent not fully configured)");
    } else {
      rec.pass("GET /api/status", `ok=${json.ok}`);
    }
  } catch (err) {
    rec.fail("GET /api/status", String(err));
  }

  // 3) Markets
  try {
    const { response, json, text } = await request("/api/markets", opts);
    if (response.status !== 200) {
      rec.fail("GET /api/markets", `HTTP ${response.status} ${truncate(text)}`);
    } else if (!json || !Array.isArray(json.markets)) {
      rec.fail("GET /api/markets", "Missing markets array");
    } else {
      marketsPayload = json;
      rec.pass("GET /api/markets", `markets=${json.markets.length}`);
    }
  } catch (err) {
    rec.fail("GET /api/markets", String(err));
  }

  // 4) Heartbeat
  try {
    const headers = { "content-type": "application/json" };
    if (opts.heartbeatSecret) {
      headers["x-heartbeat-secret"] = opts.heartbeatSecret;
    }

    const { response, json, text } = await request("/api/heartbeat", {
      ...opts,
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    if (response.status === 200) {
      if (json && json.ok === false) {
        rec.warn("POST /api/heartbeat", truncate(json.error || json.message || "tick reported error"));
      } else {
        rec.pass("POST /api/heartbeat", "tick request accepted");
      }
    } else if (response.status === 401 && !opts.heartbeatSecret) {
      rec.warn(
        "POST /api/heartbeat",
        "unauthorized without --heartbeat-secret (expected when HEARTBEAT_SECRET is configured)",
      );
    } else {
      rec.fail("POST /api/heartbeat", `HTTP ${response.status} ${truncate(text)}`);
    }
  } catch (err) {
    rec.fail("POST /api/heartbeat", String(err));
  }

  // 5) Well-known manifests
  for (const path of ["/.well-known/agent.json", "/.well-known/agent-card.json"]) {
    try {
      const { response, json, text } = await request(path, opts);
      if (response.status !== 200) {
        rec.fail(`GET ${path}`, `HTTP ${response.status} ${truncate(text)}`);
      } else if (!json || typeof json !== "object") {
        rec.fail(`GET ${path}`, "Unexpected non-JSON response");
      } else {
        rec.pass(`GET ${path}`);
      }
    } catch (err) {
      rec.fail(`GET ${path}`, String(err));
    }
  }

  // 6) Predict stream
  if (opts.skipPredict) {
    rec.warn("POST /api/predict", "skipped by --skip-predict");
  } else {
    const derivedMarketId =
      opts.marketId ??
      (marketsPayload && Array.isArray(marketsPayload.markets) && marketsPayload.markets[0]
        ? Number.parseInt(String(marketsPayload.markets[0].id), 10)
        : null);

    if (!derivedMarketId || !Number.isInteger(derivedMarketId) || derivedMarketId < 1) {
      rec.warn("POST /api/predict", "no market ID available (use --market-id)");
    } else {
      try {
        const { response, contentType, text } = await request("/api/predict", {
          ...opts,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ marketId: derivedMarketId }),
        });

        if (response.status === 200) {
          if (!contentType.includes("text/event-stream")) {
            rec.fail(
              "POST /api/predict",
              `expected text/event-stream, got ${contentType || "<empty>"}`,
            );
          } else {
            const preview = await readSsePreview(response, opts.sseTimeoutMs);
            if (preview.includes('"type":"error"')) {
              rec.warn("POST /api/predict", `SSE error event: ${truncate(preview)}`);
            } else if (preview.includes("data:")) {
              rec.pass("POST /api/predict", `stream active for marketId=${derivedMarketId}`);
            } else {
              rec.warn("POST /api/predict", "stream opened but no SSE frame observed within timeout");
            }
          }
        } else if (response.status === 400 && text.includes("Anthropic API key not configured")) {
          rec.warn("POST /api/predict", "Anthropic API key not configured");
        } else if (response.status === 402) {
          rec.warn("POST /api/predict", "X-402 payment required");
        } else if (response.status === 429) {
          rec.warn("POST /api/predict", "rate limited");
        } else {
          rec.fail("POST /api/predict", `HTTP ${response.status} ${truncate(text)}`);
        }
      } catch (err) {
        rec.fail("POST /api/predict", String(err));
      }
    }
  }

  const summary = rec.summary();
  console.log("");
  console.log(`Summary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed`);

  if (summary.fail > 0) {
    process.exit(1);
  }
  if (opts.strict && summary.warn > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
