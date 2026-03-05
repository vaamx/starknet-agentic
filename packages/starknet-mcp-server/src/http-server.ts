#!/usr/bin/env node
/**
 * HTTP MCP Server — StreamableHTTP transport (MCP spec 2025-03-26)
 *
 * Exposes all starknet-mcp-server tools over HTTP for remote agent runtimes
 * (Daydreams, Conway, browser-based OpenClaw, etc.).
 *
 * Usage:
 *   STARKNET_RPC_URL=... STARKNET_ACCOUNT_ADDRESS=... STARKNET_PRIVATE_KEY=... \
 *   AGENT_MCP_TOKEN=<secret> node dist/http-server.js
 *
 * Environment:
 *   HTTP_PORT          Port to listen on (default: 3002)
 *   AGENT_MCP_TOKEN    Optional Bearer token for auth. Omit to allow unauthenticated access.
 *
 * Deploy to Fly.io:
 *   fly deploy --config packages/starknet-mcp-server/fly.toml
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { server } from "./server.js";
import { log } from "./logger.js";

const port = parseInt(process.env.HTTP_PORT ?? "3002", 10);
const authToken = process.env.AGENT_MCP_TOKEN;

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual_str(a: string, b: string): boolean {
  // Pad both to the same length so timingSafeEqual doesn't throw.
  const aBuf = Buffer.from(a.padEnd(Math.max(a.length, b.length), "\0"), "utf-8");
  const bBuf = Buffer.from(b.padEnd(Math.max(a.length, b.length), "\0"), "utf-8");
  return timingSafeEqual(aBuf, bBuf);
}

/** Max request body size (1 MiB). Prevents memory exhaustion from large payloads. */
const MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Read the full request body as a UTF-8 string.
 * Enforces a hard 1 MiB limit; rejects if exceeded.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", (err) => reject(err));
  });
}

async function main(): Promise<void> {
  if (authToken) {
    log({ level: "info", event: "http.auth", details: { mode: "bearer-token" } });
  } else {
    log({ level: "warn", event: "http.auth", details: { mode: "none", warning: "No AGENT_MCP_TOKEN set — server is unauthenticated" } });
  }

  // Stateless transport: each request is processed independently.
  // sessionIdGenerator: undefined = stateless mode (no server-side session state).
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  log({ level: "info", event: "server.connected", details: { transport: "http" } });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS — required for browser-based agents and OpenClaw
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Bearer token auth gate (constant-time comparison prevents timing attacks)
    if (authToken) {
      const auth = req.headers["authorization"] ?? "";
      if (!auth.startsWith("Bearer ") || !timingSafeEqual_str(auth.slice(7), authToken)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        log({ level: "warn", event: "http.auth.rejected", details: { ip: req.socket?.remoteAddress } });
        return;
      }
    }

    try {
      // Parse body for POST requests so the transport receives a parsed object.
      let parsedBody: unknown;
      if (req.method === "POST") {
        const raw = await readBody(req);
        if (raw) {
          try {
            parsedBody = JSON.parse(raw);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
        }
      }
      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log({ level: "error", event: "http.request.error", details: { error: message } });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  httpServer.listen(port, () => {
    const authInfo = authToken ? " (Bearer auth enabled)" : " (WARNING: no auth)";
    log({
      level: "info",
      event: "server.started",
      details: { transport: "http", port, auth: !!authToken },
    });
    console.error(`[starknet-mcp] HTTP server listening on :${port}${authInfo}`);
  });

  httpServer.on("error", (err) => {
    log({ level: "error", event: "server.fatal", details: { error: err.message } });
    process.exit(1);
  });
}

main().catch((err) => {
  log({
    level: "error",
    event: "server.fatal",
    details: { error: err instanceof Error ? err.message : String(err) },
  });
  process.exit(1);
});
