/**
 * Machines routes — create, heartbeat, get, list, destroy.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { machineDb } from "../db.js";
import { flyClient } from "../fly-client.js";
import { escrowClient } from "../escrow-client.js";
import { x402Guard } from "../x402-verifier.js";
import {
  heartbeatCostWei,
  hourlyRateWei,
  type MachineTier,
} from "@starknet-agentic/bitsage-cloud-sdk";

export async function machinesRoutes(app: FastifyInstance) {
  /**
   * POST /machines/create
   *
   * Provision a new Fly.io machine for an agent.
   * Protected by X-402 payment verification.
   */
  app.post<{
    Body: { agentAddress: string; tier?: MachineTier; envVars?: Record<string, string> }
  }>("/machines/create", { preHandler: x402Guard }, async (req, reply) => {
    const { agentAddress, tier = "nano", envVars = {} } = req.body;

    if (!agentAddress?.startsWith("0x")) {
      return reply.status(400).send({ error: "Invalid agentAddress" });
    }

    const validTiers: MachineTier[] = ["nano", "micro", "small"];
    if (!validTiers.includes(tier)) {
      return reply.status(400).send({ error: `Invalid tier. Must be one of: ${validTiers.join(", ")}` });
    }

    // Check balance before provisioning
    let balance: bigint;
    try {
      balance = await escrowClient.balanceOf(agentAddress);
    } catch (err) {
      return reply.status(502).send({ error: "Failed to verify escrow balance" });
    }

    // Require at least 1 hour of balance upfront (integer arithmetic — no float).
    const oneHourCost = hourlyRateWei(tier);
    if (balance < oneHourCost) {
      return reply.status(402).send({
        error: "Insufficient escrow balance for minimum 1 hour",
        required: oneHourCost.toString(),
        current: balance.toString(),
      });
    }

    let flyMachineId: string;
    try {
      const mergedEnv = { AGENT_ADDRESS: agentAddress, ...envVars };
      const result = await flyClient.createMachine(tier, mergedEnv);
      flyMachineId = result.flyMachineId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Failed to provision machine: ${message}` });
    }

    const machine = {
      id: randomUUID(),
      flyMachineId,
      agentAddress,
      tier,
      status: "starting" as const,
      createdAt: new Date().toISOString(),
    };

    machineDb.insert(machine);

    return reply.status(201).send({
      ...machine,
      deductedTotal: "0",
    });
  });

  /**
   * GET /machines/:id
   */
  app.get<{ Params: { id: string } }>("/machines/:id", async (req, reply) => {
    const machine = machineDb.findById(req.params.id);
    if (!machine) return reply.status(404).send({ error: "Machine not found" });
    return reply.send(machine);
  });

  /**
   * GET /machines
   *
   * List machines for an agent. Query: ?agent=0x...
   */
  app.get<{ Querystring: { agent?: string } }>("/machines", async (req, reply) => {
    const { agent } = req.query;
    if (!agent) return reply.status(400).send({ error: "agent query parameter required" });
    return reply.send(machineDb.findByAgent(agent));
  });

  /**
   * POST /machines/:id/heartbeat
   *
   * Deduct compute cost from escrow for one heartbeat interval.
   * If balance insufficient, terminates the machine and returns 402.
   * Protected by X-402 payment verification.
   */
  app.post<{ Params: { id: string } }>("/machines/:id/heartbeat", { preHandler: x402Guard }, async (req, reply) => {
    const machine = machineDb.findById(req.params.id);
    if (!machine) return reply.status(404).send({ error: "Machine not found" });

    // Idempotent: dead machine returns ok=false without error
    if (machine.status === "dead") {
      return reply.send({ ok: false, terminated: true, error: "Machine already terminated" });
    }

    const cost = heartbeatCostWei(machine.tier);

    let balance: bigint;
    try {
      balance = await escrowClient.balanceOf(machine.agentAddress);
    } catch (err) {
      return reply.status(502).send({ error: "Failed to read escrow balance" });
    }

    if (balance < cost) {
      // Mark dead first, then terminate Fly machine asynchronously.
      // flyClient.stopMachine already logs errors internally — no .catch(() => {}) needed.
      machineDb.updateStatus(machine.id, "dead");
      setImmediate(() => void flyClient.stopMachine(machine.flyMachineId));
      return reply.status(402).send({
        ok: false,
        terminated: true,
        error: "Insufficient escrow balance — machine terminated",
        required: cost.toString(),
        current: balance.toString(),
      });
    }

    // Charge escrow — idempotent via tick_id (minute bucket prevents replay).
    const tickId = BigInt(Math.floor(Date.now() / 60_000));
    try {
      await escrowClient.charge(machine.agentAddress, machine.flyMachineId, tickId, cost);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Distinguish agent-side rejections (paused/cap) from infra errors.
      if (message.includes("Billing paused") || message.includes("Daily cap exceeded")) {
        return reply.status(402).send({ error: message });
      }
      return reply.status(502).send({ error: `Escrow charge failed: ${message}` });
    }

    machineDb.updateHeartbeat(machine.id, new Date().toISOString(), cost);

    return reply.send({
      ok: true,
      remainingWei: (balance - cost).toString(),
    });
  });

  /**
   * DELETE /machines/:id
   */
  app.delete<{ Params: { id: string } }>("/machines/:id", async (req, reply) => {
    const machine = machineDb.findById(req.params.id);
    if (!machine) return reply.status(404).send({ error: "Machine not found" });

    machineDb.updateStatus(machine.id, "dead");
    await flyClient.destroyMachine(machine.flyMachineId);

    return reply.send({ ok: true });
  });
}
