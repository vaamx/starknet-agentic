-- HiveCaster production schema (Postgres) for auth + org RBAC + quant telemetry

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
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip_address TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  agent_id TEXT,
  probability DOUBLE PRECISION NOT NULL,
  confidence DOUBLE PRECISION,
  rationale TEXT,
  model_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  market_id INTEGER,
  source_type TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  summary TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_executions (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  execution_surface TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  notional_strk DOUBLE PRECISION,
  realized_pnl_strk DOUBLE PRECISION,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_outcomes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL,
  outcome INTEGER NOT NULL,
  finalized_at INTEGER NOT NULL,
  UNIQUE (org_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_forecasts_org_created ON forecasts(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_research_org_created ON research_artifacts(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exec_org_created ON trade_executions(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_market_outcomes_org_market ON market_outcomes(org_id, market_id);
