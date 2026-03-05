/**
 * BitsagE Cloud — SQLite database layer (better-sqlite3).
 *
 * Machines table tracks all spawned Fly.io machines and their lifecycle.
 */

import Database from "better-sqlite3";
import { config } from "./config.js";
import type { Machine, MachineTier, MachineStatus } from "@starknet-agentic/bitsage-cloud-sdk";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(config.DATABASE_URL);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id              TEXT PRIMARY KEY,
      fly_machine_id  TEXT UNIQUE NOT NULL,
      agent_address   TEXT NOT NULL,
      tier            TEXT NOT NULL,
      status          TEXT DEFAULT 'starting',
      created_at      TEXT NOT NULL,
      last_heartbeat  TEXT,
      deducted_total  TEXT DEFAULT '0'
    );
    CREATE INDEX IF NOT EXISTS idx_agent ON machines(agent_address);
    CREATE INDEX IF NOT EXISTS idx_status ON machines(status);
  `);

  return _db;
}

interface MachineRow {
  id: string;
  fly_machine_id: string;
  agent_address: string;
  tier: MachineTier;
  status: MachineStatus;
  created_at: string;
  last_heartbeat: string | null;
  deducted_total: string;
}

function rowToMachine(row: MachineRow): Machine {
  return {
    id: row.id,
    flyMachineId: row.fly_machine_id,
    agentAddress: row.agent_address,
    tier: row.tier,
    status: row.status,
    createdAt: row.created_at,
    lastHeartbeat: row.last_heartbeat ?? undefined,
    deductedTotal: row.deducted_total,
  };
}

export const machineDb = {
  insert(machine: Omit<Machine, "lastHeartbeat" | "deductedTotal">): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO machines (id, fly_machine_id, agent_address, tier, status, created_at, deducted_total)
      VALUES (?, ?, ?, ?, ?, ?, '0')
    `).run(machine.id, machine.flyMachineId, machine.agentAddress, machine.tier, machine.status, machine.createdAt);
  },

  findById(id: string): Machine | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM machines WHERE id = ?").get(id) as MachineRow | undefined;
    return row ? rowToMachine(row) : null;
  },

  findByAgent(agentAddress: string): Machine[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM machines WHERE agent_address = ? ORDER BY created_at DESC").all(agentAddress) as MachineRow[];
    return rows.map(rowToMachine);
  },

  updateStatus(id: string, status: MachineStatus): void {
    getDb().prepare("UPDATE machines SET status = ? WHERE id = ?").run(status, id);
  },

  /**
   * Atomically record a heartbeat deduction.
   * Wrapped in a SQLite transaction so the read-modify-write is never interleaved
   * with another write even in multi-request bursts (better-sqlite3 is synchronous,
   * but explicit transactions make the intent clear and prevent future regressions
   * if async adapters are added later).
   */
  updateHeartbeat(id: string, lastHeartbeat: string, addDeducted: bigint): void {
    const db = getDb();
    const atomicUpdate = db.transaction(() => {
      const row = db.prepare("SELECT deducted_total FROM machines WHERE id = ?").get(id) as
        | { deducted_total: string }
        | undefined;
      if (!row) return;
      const prev = BigInt(row.deducted_total || "0");
      const newTotal = (prev + addDeducted).toString();
      db.prepare("UPDATE machines SET last_heartbeat = ?, deducted_total = ? WHERE id = ?")
        .run(lastHeartbeat, newTotal, id);
    });
    atomicUpdate();
  },
};
