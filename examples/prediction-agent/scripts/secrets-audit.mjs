#!/usr/bin/env node

/**
 * Secret-store readiness audit.
 *
 * This does not print secret values; it only reports missing/placeholder keys.
 */

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage: node scripts/secrets-audit.mjs [options]

Checks required production secrets and launch env keys.

Options:
  --env-file <path>           Env file to load before auditing (default: .env)
  --require-upstash         Require Upstash for both rate limiting and persisted state
  --require-alert-channels  Require AGENT_ALERTING_ENABLED=true and at least one channel
  --json                    Print machine-readable JSON result
  -h, --help                Show help
`);
}

function isPlaceholder(value) {
  if (!value) return true;
  const lowered = String(value).toLowerCase().trim();
  if (!lowered) return true;
  if (lowered.includes("...")) return true;
  return [
    "replace-me",
    "replace-with-random-secret",
    "your-secret",
    "changeme",
    "todo",
    "tbd",
  ].includes(lowered);
}

function isHttpUrl(value) {
  if (!value) return false;
  return /^https?:\/\/.+$/i.test(String(value));
}

function parseArgs(argv) {
  const opts = {
    envFile: ".env",
    requireUpstash: false,
    requireAlertChannels: false,
    asJson: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--require-upstash") {
      opts.requireUpstash = true;
      continue;
    }
    if (arg === "--env-file") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --env-file");
      opts.envFile = value;
      continue;
    }
    if (arg === "--require-alert-channels") {
      opts.requireAlertChannels = true;
      continue;
    }
    if (arg === "--json") {
      opts.asJson = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return opts;
}

function parseEnvValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(envFile) {
  const resolved = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(resolved)) {
    return { loaded: false, path: resolved };
  }

  const content = fs.readFileSync(resolved, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = parseEnvValue(trimmed.slice(eq + 1));

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  return { loaded: true, path: resolved };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envInfo = loadEnvFile(opts.envFile);

  const errors = [];
  const warnings = [];
  let needsUpstashCredentials = opts.requireUpstash;

  function requireKey(name) {
    const value = process.env[name];
    if (!value) {
      errors.push(`${name} is missing`);
      return null;
    }
    if (isPlaceholder(value)) {
      errors.push(`${name} is placeholder-like`);
      return null;
    }
    return value;
  }

  requireKey("STARKNET_RPC_URL");
  requireKey("AGENT_ADDRESS");
  requireKey("AGENT_PRIVATE_KEY");
  requireKey("MARKET_FACTORY_ADDRESS");
  requireKey("ACCURACY_TRACKER_ADDRESS");
  const forecastProvider =
    process.env.AGENT_LLM_PROVIDER_FORECAST &&
    process.env.AGENT_LLM_PROVIDER_FORECAST !== "default"
      ? process.env.AGENT_LLM_PROVIDER_FORECAST
      : process.env.AGENT_LLM_PROVIDER || "auto";

  if (forecastProvider === "anthropic") {
    requireKey("ANTHROPIC_API_KEY");
  } else if (forecastProvider === "xai") {
    requireKey("XAI_API_KEY");
  } else if (forecastProvider === "local") {
    requireKey("OLLAMA_BASE_URL");
    requireKey("OLLAMA_MODEL");
  } else if (forecastProvider === "auto") {
    const hasXai = !!process.env.XAI_API_KEY && !isPlaceholder(process.env.XAI_API_KEY);
    const hasAnthropic =
      !!process.env.ANTHROPIC_API_KEY &&
      !isPlaceholder(process.env.ANTHROPIC_API_KEY);
    const hasLocal =
      !!process.env.OLLAMA_BASE_URL &&
      !isPlaceholder(process.env.OLLAMA_BASE_URL) &&
      !!process.env.OLLAMA_MODEL &&
      !isPlaceholder(process.env.OLLAMA_MODEL);
    if (!hasXai && !hasAnthropic && !hasLocal) {
      errors.push(
        "No LLM provider configured (set XAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL + OLLAMA_MODEL)"
      );
    }
  } else {
    errors.push(
      "AGENT_LLM_PROVIDER/AGENT_LLM_PROVIDER_FORECAST must be auto|anthropic|xai|local"
    );
  }
  requireKey("HEARTBEAT_SECRET");

  const rateLimitBackend = process.env.RATE_LIMIT_BACKEND;
  if (!rateLimitBackend) {
    errors.push("RATE_LIMIT_BACKEND is missing");
  } else if (!["memory", "upstash"].includes(rateLimitBackend)) {
    errors.push("RATE_LIMIT_BACKEND must be memory or upstash");
  } else if (rateLimitBackend === "memory") {
    if (opts.requireUpstash) {
      errors.push("RATE_LIMIT_BACKEND=memory but --require-upstash is enabled");
    } else {
      warnings.push("RATE_LIMIT_BACKEND=memory is not multi-replica safe");
    }
  } else if (rateLimitBackend === "upstash") {
    needsUpstashCredentials = true;
  }

  const stateBackend = process.env.AGENT_STATE_BACKEND || "auto";
  if (!["auto", "upstash", "file"].includes(stateBackend)) {
    errors.push("AGENT_STATE_BACKEND must be auto, upstash, or file");
  } else if (stateBackend === "auto") {
    if (opts.requireUpstash) {
      errors.push("AGENT_STATE_BACKEND=auto but --require-upstash is enabled");
    } else {
      warnings.push(
        "AGENT_STATE_BACKEND=auto may fall back to local file state if Upstash is unavailable"
      );
    }
  } else if (stateBackend === "file") {
    if (opts.requireUpstash) {
      errors.push("AGENT_STATE_BACKEND=file but --require-upstash is enabled");
    } else {
      warnings.push("AGENT_STATE_BACKEND=file is not multi-replica safe");
    }
  } else if (stateBackend === "upstash") {
    needsUpstashCredentials = true;
    requireKey("AGENT_STATE_UPSTASH_KEY");
  }

  const globalRate = process.env.RATE_LIMIT_GLOBAL_PER_MIN;
  if (!globalRate) {
    errors.push("RATE_LIMIT_GLOBAL_PER_MIN is missing");
  } else {
    const parsed = Number.parseInt(globalRate, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors.push("RATE_LIMIT_GLOBAL_PER_MIN must be a positive integer");
    }
  }

  if (needsUpstashCredentials) {
    const url = requireKey("UPSTASH_REDIS_REST_URL");
    if (url && !isHttpUrl(url)) {
      errors.push("UPSTASH_REDIS_REST_URL must be a valid http(s) URL");
    }
    requireKey("UPSTASH_REDIS_REST_TOKEN");
  }

  const alertingEnabled = process.env.AGENT_ALERTING_ENABLED === "true";
  if (opts.requireAlertChannels && !alertingEnabled) {
    errors.push("AGENT_ALERTING_ENABLED must be true when --require-alert-channels is enabled");
  }

  if (alertingEnabled || opts.requireAlertChannels) {
    const webhook = process.env.AGENT_ALERT_WEBHOOK_URL;
    const slack = process.env.AGENT_ALERT_SLACK_WEBHOOK_URL;
    const pagerDuty = process.env.AGENT_ALERT_PAGERDUTY_ROUTING_KEY;

    let channelCount = 0;
    if (webhook) {
      if (isPlaceholder(webhook) || !isHttpUrl(webhook)) {
        errors.push("AGENT_ALERT_WEBHOOK_URL is invalid or placeholder-like");
      } else {
        channelCount += 1;
      }
    }
    if (slack) {
      if (isPlaceholder(slack) || !isHttpUrl(slack)) {
        errors.push("AGENT_ALERT_SLACK_WEBHOOK_URL is invalid or placeholder-like");
      } else {
        channelCount += 1;
      }
    }
    if (pagerDuty) {
      if (isPlaceholder(pagerDuty)) {
        errors.push("AGENT_ALERT_PAGERDUTY_ROUTING_KEY is placeholder-like");
      } else {
        channelCount += 1;
      }
    }

    const alertSecret = process.env.AGENT_ALERT_TEST_SECRET || process.env.HEARTBEAT_SECRET;
    if (!alertSecret || isPlaceholder(alertSecret)) {
      errors.push("AGENT_ALERT_TEST_SECRET (or HEARTBEAT_SECRET fallback) is missing/placeholder");
    }

    if (channelCount === 0) {
      if (opts.requireAlertChannels) {
        errors.push("No alert delivery channel configured");
      } else {
        warnings.push("Alerting enabled but no channel configured");
      }
    }
  }

  const result = {
    ok: errors.length === 0,
    errors,
    warnings,
    envFile: envInfo,
    checks: {
      requireUpstash: opts.requireUpstash,
      requireAlertChannels: opts.requireAlertChannels,
    },
  };

  if (opts.asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("== Prediction Agent Secret Audit ==");
    if (errors.length > 0) {
      console.log("Errors:");
      for (const entry of errors) console.log(`- ${entry}`);
    }
    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const entry of warnings) console.log(`- ${entry}`);
    }
    if (errors.length === 0 && warnings.length === 0) {
      console.log("All required launch keys look valid.");
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
