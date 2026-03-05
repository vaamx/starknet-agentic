#!/usr/bin/env node

/**
 * Launch closure runner for prediction-agent.
 *
 * Runs automated launch gates and keeps humans in the loop before
 * potentially noisy/external actions (live alert dispatch + non-local smoke).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";

const DEFAULT_BASE_URL = "http://localhost:3001";
const CHAOS_GATE_ARGS = [
  "--strict",
  "--min-failover-success-rate",
  "0.6",
  "--max-consensus-block-rate",
  "0.5",
  "--max-consensus-avg-abs-delta-pct",
  "12",
];

function usage() {
  console.log(`Usage: node scripts/launch-closure.mjs [options]

Automates launch closure for prediction-agent with human approval gates.

Options:
  --base-url <url>              Base URL for API checks (default: ${DEFAULT_BASE_URL})
  --heartbeat-secret <secret>   Secret for heartbeat + smoke checks
  --alert-test-secret <secret>  Secret for /api/alerts/test
  --alert-severity <level>      warning | critical (default: warning)
  --market-id <id>              Optional market ID for smoke predict check
  --production                  Enforce production gates (upstash + alert channels + alert delivery)
  --require-upstash             Require upstash-backed rate limiting
  --require-alert-channels      Require AGENT_ALERTING_ENABLED=true with at least one channel configured
  --require-alert-delivery      Fail if live alert roundtrip emits 0 deliveries
  --live-alerts                 Run live alert roundtrip (otherwise prompt/skip)
  --yes                         Auto-approve interactive prompts
  --non-interactive             Never prompt; skips approval-gated checks unless forced
  --skip-preflight              Skip pnpm preflight
  --skip-secrets-audit          Skip secrets:audit gate
  --skip-chaos                  Skip deterministic chaos SLO gate
  --skip-alerts                 Skip alert roundtrip checks
  --skip-smoke                  Skip deployed smoke
  --strict                      Treat warnings/skips as failure
  -h, --help                    Show help
`);
}

function parseArgs(argv) {
  const opts = {
    baseUrl: DEFAULT_BASE_URL,
    heartbeatSecret: process.env.HEARTBEAT_SECRET || "",
    alertTestSecret:
      process.env.AGENT_ALERT_TEST_SECRET || process.env.HEARTBEAT_SECRET || "",
    alertSeverity: "warning",
    marketId: null,
    production: false,
    requireUpstash: false,
    requireAlertChannels: false,
    requireAlertDelivery: false,
    liveAlerts: false,
    yes: false,
    nonInteractive: false,
    skipPreflight: false,
    skipSecretsAudit: false,
    skipChaos: false,
    skipAlerts: false,
    skipSmoke: false,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--base-url") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --base-url");
      opts.baseUrl = value;
      continue;
    }
    if (arg === "--heartbeat-secret") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --heartbeat-secret");
      opts.heartbeatSecret = value;
      continue;
    }
    if (arg === "--alert-test-secret") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --alert-test-secret");
      opts.alertTestSecret = value;
      continue;
    }
    if (arg === "--alert-severity") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --alert-severity");
      if (value !== "warning" && value !== "critical") {
        throw new Error("--alert-severity must be warning or critical");
      }
      opts.alertSeverity = value;
      continue;
    }
    if (arg === "--market-id") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --market-id");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--market-id must be a positive integer");
      }
      opts.marketId = parsed;
      continue;
    }
    if (arg === "--production") {
      opts.production = true;
      continue;
    }
    if (arg === "--require-upstash") {
      opts.requireUpstash = true;
      continue;
    }
    if (arg === "--require-alert-channels") {
      opts.requireAlertChannels = true;
      continue;
    }
    if (arg === "--require-alert-delivery") {
      opts.requireAlertDelivery = true;
      continue;
    }
    if (arg === "--live-alerts") {
      opts.liveAlerts = true;
      continue;
    }
    if (arg === "--yes") {
      opts.yes = true;
      continue;
    }
    if (arg === "--non-interactive") {
      opts.nonInteractive = true;
      continue;
    }
    if (arg === "--skip-preflight") {
      opts.skipPreflight = true;
      continue;
    }
    if (arg === "--skip-secrets-audit") {
      opts.skipSecretsAudit = true;
      continue;
    }
    if (arg === "--skip-chaos") {
      opts.skipChaos = true;
      continue;
    }
    if (arg === "--skip-alerts") {
      opts.skipAlerts = true;
      continue;
    }
    if (arg === "--skip-smoke") {
      opts.skipSmoke = true;
      continue;
    }
    if (arg === "--strict") {
      opts.strict = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  try {
    const parsed = new URL(opts.baseUrl);
    opts.baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid --base-url: ${opts.baseUrl}`);
  }

  return opts;
}

function isLocalBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function makeRecorder() {
  const rows = [];
  function push(status, check, detail = "") {
    rows.push({ status, check, detail });
    const icon =
      status === "pass"
        ? "[PASS]"
        : status === "warn"
          ? "[WARN]"
          : status === "skip"
            ? "[SKIP]"
            : "[FAIL]";
    console.log(`${icon} ${check}${detail ? `: ${detail}` : ""}`);
  }

  return {
    pass: (check, detail) => push("pass", check, detail),
    warn: (check, detail) => push("warn", check, detail),
    skip: (check, detail) => push("skip", check, detail),
    fail: (check, detail) => push("fail", check, detail),
    summary: () => {
      const counts = { pass: 0, warn: 0, skip: 0, fail: 0 };
      for (const row of rows) {
        counts[row.status] += 1;
      }
      return { rows, counts };
    },
  };
}

function runCommand(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function createPrompter(enabled) {
  if (!enabled) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    ask(question) {
      return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      });
    },
    close() {
      rl.close();
    },
  };
}

async function promptYesNo(prompter, question, defaultNo = true) {
  if (!prompter) return false;
  const suffix = defaultNo ? " [y/N] " : " [Y/n] ";
  const answer = (await prompter.ask(`${question}${suffix}`)).toLowerCase();
  if (!answer) return !defaultNo;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return !defaultNo;
}

async function postJson(url, body, headers = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { response, text, json };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rec = makeRecorder();
  const requireUpstash = opts.production || opts.requireUpstash;
  const requireAlertChannels = opts.production || opts.requireAlertChannels;
  const requireAlertDelivery = opts.production || opts.requireAlertDelivery;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(scriptDir, "..");
  const interactive =
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !opts.nonInteractive &&
    !opts.yes;
  const prompter = createPrompter(interactive);

  console.log("== Prediction Agent Launch Closure ==");
  console.log(`base_url=${opts.baseUrl}`);
  console.log(`strict=${opts.strict ? "on" : "off"} interactive=${interactive ? "on" : "off"}`);
  console.log(
    `gates: upstash=${requireUpstash ? "required" : "optional"} ` +
      `alert_channels=${requireAlertChannels ? "required" : "optional"} ` +
      `alert_delivery=${requireAlertDelivery ? "required" : "optional"}`
  );
  console.log("");

  try {
    if (opts.skipPreflight) {
      rec.skip("preflight", "skipped by flag");
    } else {
      const preflightArgs = ["pnpm", "preflight"];
      const extra = [];
      if (requireUpstash) extra.push("--require-upstash");
      if (requireAlertChannels) extra.push("--require-alert-channels");
      if (extra.length > 0) {
        preflightArgs.push("--", ...extra);
      }

      const code = await runCommand(preflightArgs, appDir);
      if (code === 0) {
        rec.pass("preflight", "env, tests, and production build passed");
      } else {
        rec.fail("preflight", `exit code ${code}`);
      }
    }

    if (opts.skipSecretsAudit) {
      rec.skip("secrets-audit", "skipped by flag");
    } else {
      const auditArgs = ["pnpm", "secrets:audit"];
      const extra = [];
      if (requireUpstash) extra.push("--require-upstash");
      if (requireAlertChannels) extra.push("--require-alert-channels");
      if (extra.length > 0) {
        auditArgs.push("--", ...extra);
      }
      const code = await runCommand(auditArgs, appDir);
      if (code === 0) {
        rec.pass("secrets-audit", "required launch secrets are configured");
      } else {
        rec.fail("secrets-audit", `exit code ${code}`);
      }
    }

    if (opts.skipChaos) {
      rec.skip("chaos-slo", "skipped by flag");
    } else {
      const code = await runCommand(
        ["pnpm", "chaos:sim", "--", ...CHAOS_GATE_ARGS],
        appDir
      );
      if (code === 0) {
        rec.pass("chaos-slo", "deterministic failover/consensus SLO gate passed");
      } else {
        rec.fail("chaos-slo", `exit code ${code}`);
      }
    }

    if (opts.skipAlerts) {
      if (requireAlertDelivery) {
        rec.fail("alerts-test-live", "cannot skip alerts when --require-alert-delivery is enabled");
      } else {
        rec.skip("alerts-test-dry-run", "skipped by flag");
        rec.skip("alerts-test-live", "skipped by flag");
      }
    } else if (!opts.alertTestSecret) {
      rec.fail(
        "alerts-test",
        "missing alert test secret (--alert-test-secret or AGENT_ALERT_TEST_SECRET)"
      );
    } else {
      const alertsUrl = `${opts.baseUrl}/api/alerts/test`;

      try {
        const dry = await postJson(
          alertsUrl,
          {
            mode: "roundtrip",
            severity: opts.alertSeverity,
            dryRun: true,
          },
          {
            "x-heartbeat-secret": opts.alertTestSecret,
          }
        );
        const ok = dry.response.ok && dry.json?.ok;
        if (ok) {
          const summary = dry.json?.summary ?? {};
          rec.pass(
            "alerts-test-dry-run",
            `triggered=${summary.triggered ?? 0} resolved=${summary.resolved ?? 0}`
          );
        } else {
          rec.fail(
            "alerts-test-dry-run",
            `HTTP ${dry.response.status} ${String(dry.text || "").slice(0, 220)}`
          );
        }
      } catch (err) {
        rec.fail("alerts-test-dry-run", String(err));
      }

      let runLiveAlerts = opts.liveAlerts || opts.yes;
      if (!runLiveAlerts && interactive) {
        runLiveAlerts = await promptYesNo(
          prompter,
          "Dispatch live alert roundtrip now (webhook/slack/pagerduty)?",
          true
        );
      }

      if (!runLiveAlerts) {
        if (requireAlertDelivery) {
          rec.fail(
            "alerts-test-live",
            "operator approval required (use --live-alerts/--yes) while --require-alert-delivery is enabled"
          );
        } else {
          rec.skip("alerts-test-live", "requires operator approval (--live-alerts or --yes)");
        }
      } else {
        try {
          const live = await postJson(
            alertsUrl,
            {
              mode: "roundtrip",
              severity: opts.alertSeverity,
              dryRun: false,
            },
            {
              "x-heartbeat-secret": opts.alertTestSecret,
            }
          );
          const ok = live.response.ok && live.json?.ok;
          if (ok) {
            const summary = live.json?.summary ?? {};
            const sent = Number(summary.sent ?? 0);
            if (sent > 0) {
              rec.pass(
                "alerts-test-live",
                `sent=${sent} failed=${summary.failed ?? 0} triggered=${summary.triggered ?? 0} resolved=${summary.resolved ?? 0}`
              );
            } else {
              if (requireAlertDelivery) {
                rec.fail(
                  "alerts-test-live",
                  "roundtrip succeeded but no channel delivery occurred"
                );
              } else {
                rec.warn(
                  "alerts-test-live",
                  "roundtrip succeeded but no channel delivery occurred (check routing/channel env)"
                );
              }
            }
          } else {
            rec.fail(
              "alerts-test-live",
              `HTTP ${live.response.status} ${String(live.text || "").slice(0, 220)}`
            );
          }
        } catch (err) {
          rec.fail("alerts-test-live", String(err));
        }
      }
    }

    if (opts.skipSmoke) {
      rec.skip("deployed-smoke", "skipped by flag");
    } else if (!opts.heartbeatSecret) {
      rec.fail("deployed-smoke", "missing heartbeat secret (--heartbeat-secret or HEARTBEAT_SECRET)");
    } else {
      let approved = true;
      if (!isLocalBaseUrl(opts.baseUrl) && !opts.yes) {
        if (interactive) {
          approved = await promptYesNo(
            prompter,
            `Run deployed smoke against ${opts.baseUrl}?`,
            true
          );
        } else {
          approved = false;
        }
      }

      if (!approved) {
        rec.skip("deployed-smoke", "requires operator approval for non-local target");
      } else {
        const smokeArgs = [
          "pnpm",
          "smoke:deployed",
          "--",
          "--base-url",
          opts.baseUrl,
          "--heartbeat-secret",
          opts.heartbeatSecret,
        ];
        if (requireUpstash) {
          smokeArgs.push("--require-upstash");
        }
        if (opts.marketId) {
          smokeArgs.push("--market-id", String(opts.marketId));
        }
        const code = await runCommand(smokeArgs, appDir);
        if (code === 0) {
          rec.pass("deployed-smoke", "status/health/markets/heartbeat/predict checks passed");
        } else {
          rec.fail("deployed-smoke", `exit code ${code}`);
        }
      }
    }

    if (interactive || opts.yes) {
      const checkHeartbeat = opts.yes
        ? true
        : await promptYesNo(
            prompter,
            "Confirm Cloudflare + GitHub heartbeat fallbacks are enabled in deployment?",
            true
          );
      if (checkHeartbeat) {
        rec.pass("manual-heartbeat-fallbacks", "operator confirmed");
      } else {
        rec.warn("manual-heartbeat-fallbacks", "operator did not confirm");
      }

      const checkSecrets = opts.yes
        ? true
        : await promptYesNo(
            prompter,
            "Confirm production secrets are only in secret manager (not repo/local files)?",
            true
          );
      if (checkSecrets) {
        rec.pass("manual-secrets-hygiene", "operator confirmed");
      } else {
        rec.warn("manual-secrets-hygiene", "operator did not confirm");
      }

      const checkOncall = opts.yes
        ? true
        : await promptYesNo(
            prompter,
            "Confirm oncall escalation path (Slack/PagerDuty) is staffed for launch window?",
            true
          );
      if (checkOncall) {
        rec.pass("manual-oncall-readiness", "operator confirmed");
      } else {
        rec.warn("manual-oncall-readiness", "operator did not confirm");
      }
    } else {
      rec.warn("manual-heartbeat-fallbacks", "manual confirmation pending");
      rec.warn("manual-secrets-hygiene", "manual confirmation pending");
      rec.warn("manual-oncall-readiness", "manual confirmation pending");
    }
  } finally {
    prompter?.close();
  }

  const { counts, rows } = rec.summary();
  console.log("");
  console.log("== Launch Closure Summary ==");
  console.log(
    `pass=${counts.pass} warn=${counts.warn} skip=${counts.skip} fail=${counts.fail}`
  );
  const failedChecks = rows.filter((r) => r.status === "fail").map((r) => r.check);
  const warningChecks = rows
    .filter((r) => r.status === "warn" || r.status === "skip")
    .map((r) => r.check);

  if (counts.fail > 0) {
    console.error(`Blocking failures: ${failedChecks.join(", ")}`);
    process.exit(1);
  }

  if (opts.strict && (counts.warn > 0 || counts.skip > 0)) {
    console.error(`Strict mode blocked by warnings/skips: ${warningChecks.join(", ")}`);
    process.exit(1);
  }

  console.log("Launch closure gates completed.");
}

main().catch((err) => {
  console.error(`launch-closure error: ${err?.message ?? String(err)}`);
  process.exit(1);
});
