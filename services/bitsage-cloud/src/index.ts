/**
 * BitsagE Cloud — Fastify API server.
 *
 * Routes:
 *   POST /machines/create          — provision compute machine (X-402)
 *   GET  /machines/:id             — get machine state
 *   GET  /machines                 — list machines for agent (?agent=0x...)
 *   POST /machines/:id/heartbeat   — deduct compute cost (X-402)
 *   DELETE /machines/:id           — terminate machine
 *   GET  /credits/:address         — on-chain balance + estimated hours
 *   GET  /health                   — health check (for Fly.io TCP checks)
 *
 * Payment:
 *   X402_ENABLED=true (default): machine create + heartbeat require SNIP-12 signatures.
 *   X402_ENABLED=false: all routes pass without payment verification (dev mode).
 */

import Fastify from "fastify";
import { config } from "./config.js";
import { machinesRoutes } from "./routes/machines.js";
import { creditsRoutes } from "./routes/credits.js";

const app = Fastify({ logger: true });

// Register routes
await app.register(machinesRoutes);
await app.register(creditsRoutes);

// Health check
app.get("/health", async (_, reply) => {
  return reply.send({ ok: true, service: "bitsage-cloud", ts: new Date().toISOString() });
});

// Start listening
const port = parseInt(config.PORT, 10);
try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[bitsage-cloud] Listening on :${port} (X402=${config.X402_ENABLED})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
