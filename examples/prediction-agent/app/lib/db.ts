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

  CREATE TABLE IF NOT EXISTS automation_policies (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    cadence_minutes INTEGER NOT NULL DEFAULT 15,
    max_stake_strk REAL NOT NULL DEFAULT 5,
    risk_limit_strk REAL NOT NULL DEFAULT 25,
    stop_loss_pct REAL NOT NULL DEFAULT 20,
    confidence_threshold REAL NOT NULL DEFAULT 0.12,
    preferred_surface TEXT NOT NULL DEFAULT 'starkzap',
    allow_fallback_to_direct INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    last_signal_side TEXT,
    last_signal_prob REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (org_id, user_id, market_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    scheduled_for INTEGER NOT NULL,
    executed_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    execution_surface TEXT,
    amount_strk REAL,
    side INTEGER,
    probability REAL,
    tx_hash TEXT,
    error_code TEXT,
    error_message TEXT,
    realized_pnl_strk REAL,
    metadata_json TEXT,
    FOREIGN KEY (policy_id) REFERENCES automation_policies(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_comments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    parent_id TEXT,
    user_id TEXT,
    agent_id TEXT,
    actor_name TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'agent',
    reliability_score REAL,
    backtest_confidence REAL,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
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

safeExec(`
  CREATE TABLE IF NOT EXISTS resolution_attempts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL,
    strategy TEXT NOT NULL,
    status TEXT NOT NULL,
    outcome INTEGER,
    confidence REAL,
    evidence TEXT,
    reasoning TEXT,
    resolve_tx_hash TEXT,
    finalize_tx_hash TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL
  )
`);

safeExec(`
  CREATE TABLE IF NOT EXISTS resolution_statuses (
    org_id TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    last_status TEXT,
    escalation TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (org_id, market_id)
  )
`);

safeExec("CREATE INDEX IF NOT EXISTS idx_resolution_attempts_org_market_created ON resolution_attempts(org_id, market_id, created_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_resolution_attempts_org_status ON resolution_attempts(org_id, status)");
safeExec("CREATE INDEX IF NOT EXISTS idx_resolution_statuses_escalation ON resolution_statuses(org_id, escalation)");

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
safeExec("CREATE INDEX IF NOT EXISTS idx_auto_policies_org_user_market ON automation_policies(org_id, user_id, market_id)");
safeExec("CREATE INDEX IF NOT EXISTS idx_auto_policies_due ON automation_policies(org_id, user_id, enabled, status, next_run_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_auto_runs_policy_time ON automation_runs(policy_id, executed_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_agent_comments_org_market_created ON agent_comments(org_id, market_id, created_at)");
safeExec("CREATE INDEX IF NOT EXISTS idx_agent_comments_org_created ON agent_comments(org_id, created_at)");

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
