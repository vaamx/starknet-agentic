import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db, nowUnix } from "./db";
import type { MembershipRole } from "./rbac";

const COOKIE_NAME = "hc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

function authSecret(): string {
  return process.env.AUTH_SECRET ?? "dev-only-secret-change-me";
}

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function createUniqueOrgSlug(baseName: string): string {
  const base = slugify(baseName) || "workspace";
  for (let i = 0; i < 20; i++) {
    const suffix = i === 0 ? "" : `-${randomBytes(2).toString("hex")}`;
    const candidate = `${base}${suffix}`.slice(0, 56);
    const exists = db
      .prepare("SELECT id FROM organizations WHERE slug = ? LIMIT 1")
      .get(candidate) as { id: string } | undefined;
    if (!exists) return candidate;
  }
  return `${base}-${randomBytes(4).toString("hex")}`.slice(0, 56);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function signEmail(email: string): string {
  return createHmac("sha256", authSecret()).update(email).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const derived = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(digest), Buffer.from(derived));
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function createUser(params: {
  email: string;
  password: string;
  name: string;
}): AuthUser {
  const email = params.email.trim().toLowerCase();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .get(email) as { id: string } | undefined;

  if (existing) {
    throw new Error("Email already registered");
  }

  const user: AuthUser = {
    id: makeId("usr"),
    email,
    name: params.name.trim(),
  };

  const t = nowUnix();
  const passwordHash = hashPassword(params.password);
  const organizationId = makeId("org");
  const membershipId = makeId("mbr");
  const role: MembershipRole = "owner";
  const orgName = `${user.name}'s Workspace`;
  const orgSlug = createUniqueOrgSlug(orgName);

  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(user.id, user.email, user.name, passwordHash, t, t);

    db.prepare(
      "INSERT INTO organizations (id, name, slug, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(organizationId, orgName, orgSlug, user.id, t, t);

    db.prepare(
      "INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(membershipId, organizationId, user.id, role, t, t);

    db.prepare(
      "INSERT INTO audit_logs (id, user_id, action, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      makeId("audit"),
      user.id,
      "auth.signup",
      "user",
      user.id,
      JSON.stringify({ emailSig: signEmail(email), organizationId, role }),
      t
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return user;
}

export function verifyUserCredentials(
  emailRaw: string,
  password: string
): AuthUser | null {
  const email = emailRaw.trim().toLowerCase();
  const row = db
    .prepare(
      "SELECT id, email, name, password_hash FROM users WHERE email = ? LIMIT 1"
    )
    .get(email) as
    | { id: string; email: string; name: string; password_hash: string }
    | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    return null;
  }

  return { id: row.id, email: row.email, name: row.name };
}

export function createSession(params: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): { token: string; expiresAt: number } {
  const token = createSessionToken();
  const tokenHash = sha256(token);
  const createdAt = nowUnix();
  const expiresAt = createdAt + SESSION_TTL_SECONDS;

  db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)"
  ).run(
    makeId("sess"),
    params.userId,
    tokenHash,
    createdAt,
    expiresAt,
    params.ipAddress ?? null,
    params.userAgent ?? null
  );

  return { token, expiresAt };
}

export function getUserFromSessionToken(token: string): AuthUser | null {
  const tokenHash = sha256(token);
  const t = nowUnix();

  const row = db
    .prepare(
      `
      SELECT u.id, u.email, u.name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
      LIMIT 1
      `
    )
    .get(tokenHash, t) as AuthUser | undefined;

  return row ?? null;
}

export function revokeSessionByToken(token: string) {
  const tokenHash = sha256(token);
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(
    nowUnix(),
    tokenHash
  );
}
