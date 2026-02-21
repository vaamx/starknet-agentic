/**
 * BitsagE Cloud — Fly.io Machines API v1 wrapper.
 *
 * Creates / stops / destroys Fly.io machines for agent compute.
 * Docs: https://fly.io/docs/machines/api/
 */

import { config } from "./config.js";
import type { MachineTier } from "@starknet-agentic/bitsage-cloud-sdk";

const FLY_API_BASE = "https://api.machines.dev/v1";

interface FlyMachineConfig {
  image: string;
  env?: Record<string, string>;
  guest: {
    cpu_kind: "shared";
    cpus: number;
    memory_mb: number;
  };
  restart?: { policy: "no" | "always" | "on-failure" };
}

const TIER_CONFIGS: Record<MachineTier, Pick<FlyMachineConfig, "guest">> = {
  nano:  { guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 } },
  micro: { guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 } },
  small: { guest: { cpu_kind: "shared", cpus: 2, memory_mb: 1024 } },
};

/** Default agent Docker image (operator configures this via FLY_AGENT_IMAGE env). */
const AGENT_IMAGE = process.env.FLY_AGENT_IMAGE ?? "ghcr.io/keep-starknet-strange/prediction-agent:latest";

async function flyFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const url = `${FLY_API_BASE}/apps/${config.FLY_APP_NAME}${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${config.FLY_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
}

export interface FlyMachineCreateResult {
  flyMachineId: string;
}

export const flyClient = {
  /** Create a new Fly.io machine for an agent. */
  async createMachine(tier: MachineTier, envVars: Record<string, string> = {}): Promise<FlyMachineCreateResult> {
    const body: FlyMachineConfig = {
      image: AGENT_IMAGE,
      env: envVars,
      guest: TIER_CONFIGS[tier].guest,
      restart: { policy: "no" },
    };

    const resp = await flyFetch("/machines", {
      method: "POST",
      body: JSON.stringify({ config: body }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Fly.io createMachine failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as { id: string };
    return { flyMachineId: data.id };
  },

  /**
   * Stop a Fly.io machine (best-effort — does not wait for stopped state).
   * Failures are logged but not re-thrown so callers don't block on Fly.io outages.
   * The machine's DB status is already marked "dead" before this is called.
   */
  async stopMachine(flyMachineId: string): Promise<void> {
    try {
      const resp = await flyFetch(`/machines/${flyMachineId}/stop`, { method: "POST" });
      if (!resp.ok && resp.status !== 404) {
        const text = await resp.text().catch(() => "");
        console.error(
          `[fly-client] stopMachine(${flyMachineId}) failed with ${resp.status}: ${text}`
        );
      }
    } catch (err) {
      // Network errors during stop are expected during Fly.io outages.
      console.error(
        `[fly-client] stopMachine(${flyMachineId}) network error: ${(err as Error).message}`
      );
    }
  },

  /** Destroy a Fly.io machine. */
  async destroyMachine(flyMachineId: string): Promise<void> {
    const resp = await flyFetch(`/machines/${flyMachineId}`, { method: "DELETE" });
    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Fly.io destroyMachine failed (${resp.status}): ${text}`);
    }
  },
};
