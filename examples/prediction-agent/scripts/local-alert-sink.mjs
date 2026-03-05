#!/usr/bin/env node

/**
 * Local webhook sink for alerting tests.
 *
 * Receives HTTP POST payloads and appends newline-delimited JSON entries
 * to a log file so launch-closure can be validated end-to-end locally.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const portRaw = process.env.PORT ?? "8787";
const port = Number.parseInt(portRaw, 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${portRaw}`);
  process.exit(1);
}

const logFile =
  process.env.ALERT_SINK_LOG ??
  path.resolve(process.cwd(), ".alert-sink.log");

function safeParseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

let received = 0;

const server = http.createServer((req, res) => {
  const chunks = [];

  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    received += 1;
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = safeParseJson(raw);

    const entry = {
      receivedAt: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
      index: received,
    };

    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, "utf8");

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, received }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local-alert-sink listening on http://127.0.0.1:${port}`);
  console.log(`logging alerts to ${logFile}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
