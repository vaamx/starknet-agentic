import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const isBuildTime =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.PREDICTION_AGENT_BUILD === "true";

let dbPath = process.env.PREDICTION_AGENT_DB_PATH;
if (!dbPath) {
  if (isBuildTime) {
    // Build workers don't require persistent storage and can contend on sqlite locks.
    dbPath = ":memory:";
  } else {
    const dataDir = path.join(process.cwd(), ".data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    dbPath = path.join(dataDir, "prediction-agent.sqlite");
  }
}

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA busy_timeout = 10000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (organization_id, user_id),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS forecasts (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    market_id INTEGER NOT NULL,
    user_id TEXT,
    agent_id TEXT,
    probability REAL NOT NULL,
    confidence REAL,
    rationale TEXT,
    model_name TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS research_artifacts (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    market_id INTEGER,
    source_type TEXT NOT NULL,
    source_url TEXT,
    title TEXT,
    summary TEXT,
    payload_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    market_id INTEGER NOT NULL,
    user_id TEXT,
    execution_surface TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    notional_strk REAL,
    realized_pnl_strk REAL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS market_outcomes (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    outcome INTEGER NOT NULL,
    finalized_at INTEGER NOT NULL,
    UNIQUE (org_id, market_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );
`);

function safeExec(sql: string) {
  try {
    db.exec(sql);
  } catch {
    // Best-effort migration; ignore if already applied or unsupported.
  }
}

safeExec("ALTER TABLE forecasts ADD COLUMN org_id TEXT");
safeExec("ALTER TABLE research_artifacts ADD COLUMN org_id TEXT");
safeExec("ALTER TABLE trade_executions ADD COLUMN org_id TEXT");
safeExec("ALTER TABLE trade_executions ADD COLUMN notional_strk REAL");
safeExec("ALTER TABLE trade_executions ADD COLUMN realized_pnl_strk REAL");
safeExec("ALTER TABLE audit_logs ADD COLUMN org_id TEXT");

safeExec("CREATE INDEX IF NOT EXISTS idx_forecasts_org_created ON forecasts(org_id, created_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_research_org_created ON research_artifacts(org_id, created_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_exec_org_created ON trade_executions(org_id, created_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org_id, created_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_market_outcomes_org_market ON market_outcomes(org_id, market_id)");

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
