/**
 * Dual persistence layer for market data: Prisma/PostgreSQL + SQLite fallback.
 *
 * At the top of every function, checks `usePrismaRuntime()`:
 *   - true  -> use Prisma client (PostgreSQL on Vercel / production)
 *   - false -> fall back to SQLite (local dev, ephemeral FS)
 *
 * SQLite DB location: data/hivecaster.db (override via MARKET_DB_DIR env var).
 */

import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import type { PersistedMarketSnapshot } from "./state-store";
import { usePrismaRuntime, getPrismaClient } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbAgentPrediction {
  agent: string;
  marketId: number;
  predictedProb: number;
  brierScore: number;
  predictionCount: number;
}

export interface DbAgentTake {
  marketId: number;
  agentName: string;
  probability: number;
  reasoning: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// SQLite Singleton (fallback path)
// ---------------------------------------------------------------------------

const DB_DIR =
  process.env.MARKET_DB_DIR ||
  path.join(process.cwd(), "data");

const DB_PATH = path.join(DB_DIR, "hivecaster.db");

let _db: BetterSqlite3.Database | null = null;

function getDb(): BetterSqlite3.Database {
  if (_db) return _db;

  mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");

  initSchema(db);
  seedMarkets(db);

  _db = db;
  return db;
}

// ---------------------------------------------------------------------------
// SQLite Schema
// ---------------------------------------------------------------------------

function initSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS markets (
      id              INTEGER PRIMARY KEY,
      address         TEXT NOT NULL DEFAULT '0x0',
      question_hash   TEXT NOT NULL DEFAULT '0x0',
      question        TEXT NOT NULL DEFAULT '',
      resolution_time INTEGER NOT NULL DEFAULT 0,
      oracle          TEXT NOT NULL DEFAULT '0x0',
      collateral_token TEXT NOT NULL DEFAULT '0x0',
      fee_bps         INTEGER NOT NULL DEFAULT 0,
      status          INTEGER NOT NULL DEFAULT 0,
      total_pool      TEXT NOT NULL DEFAULT '0',
      yes_pool        TEXT NOT NULL DEFAULT '0',
      no_pool         TEXT NOT NULL DEFAULT '0',
      implied_prob_yes REAL NOT NULL DEFAULT 0.5,
      implied_prob_no  REAL NOT NULL DEFAULT 0.5,
      winning_outcome INTEGER,
      trade_count     INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS predictions (
      agent           TEXT NOT NULL,
      market_id       INTEGER NOT NULL,
      predicted_prob  REAL NOT NULL DEFAULT 0.5,
      brier_score     REAL NOT NULL DEFAULT 0.25,
      prediction_count INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent, market_id)
    );

    CREATE TABLE IF NOT EXISTS weighted_probs (
      market_id       INTEGER PRIMARY KEY,
      weighted_prob   REAL NOT NULL DEFAULT 0.5,
      updated_at      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_takes (
      market_id       INTEGER NOT NULL,
      agent_name      TEXT NOT NULL,
      probability     REAL NOT NULL DEFAULT 0.5,
      reasoning       TEXT NOT NULL DEFAULT '',
      timestamp       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (market_id, agent_name)
    );
  `);
}

// ---------------------------------------------------------------------------
// Seed data — 14 known Sepolia markets
// ---------------------------------------------------------------------------

const SEED_QUESTIONS: Record<number, string> = {
  0: "Will the Seahawks win Super Bowl LX?",
  1: "Will the total score be over 45.5 in Super Bowl LX?",
  2: "Will any player rush for 100+ yards in Super Bowl LX?",
  3: "Will halftime last over 15 minutes in Super Bowl LX?",
  4: "Will the Super Bowl LX MVP be a quarterback?",
  5: "Will there be a defensive/special teams touchdown in Super Bowl LX?",
  6: "Will the Seahawks cover -4.5 in Super Bowl LX?",
  7: "Will the first score be a touchdown in Super Bowl LX?",
  8: "Will there be a score in the last 2 minutes of the first half in Super Bowl LX?",
  9: "Will Super Bowl LX go to overtime?",
  10: "Will ETH be above $5,000 in March 2026?",
  11: "Will STRK be above $2 in Q3 2026?",
  12: "Will Starknet reach 100 TPS in February 2026?",
  13: "Will BTC be above $90k in February 2026?",
};

/** Featured seed markets — use high IDs (900+) to avoid on-chain ID conflicts.
 *  These are upserted (not INSERT OR IGNORE) so they always stay fresh. */
const FEATURED_SEEDS: Record<number, { question: string; probYes: number; poolWei: string; hoursUntilResolution: number }> = {
  900: { question: "Will the Lakers beat the Celtics in tonight's NBA game?", probYes: 0.58, poolWei: "320000000000000000000", hoursUntilResolution: 4 },
  901: { question: "Will the NBA Lakers vs Celtics total score be over 220.5?", probYes: 0.52, poolWei: "185000000000000000000", hoursUntilResolution: 4 },
  902: { question: "Who will be the next Supreme Leader of Iran?", probYes: 0.18, poolWei: "240000000000000000000", hoursUntilResolution: 720 },
  903: { question: "Will the WHO declare a new global pandemic emergency by 2027?", probYes: 0.32, poolWei: "210000000000000000000", hoursUntilResolution: 2160 },
  904: { question: "Texas Democratic Senate Primary Winner", probYes: 0.75, poolWei: "280000000000000000000", hoursUntilResolution: 48 },
  905: { question: "Which party wins the 2026 Senate midterm elections?", probYes: 0.55, poolWei: "350000000000000000000", hoursUntilResolution: 4320 },
};

// ---------------------------------------------------------------------------
// SQLite seed helper
// ---------------------------------------------------------------------------

function seedMarkets(db: BetterSqlite3.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO markets
      (id, question, resolution_time, implied_prob_yes, implied_prob_no, updated_at)
    VALUES
      (@id, @question, @resolutionTime, 0.5, 0.5, @updatedAt)
  `);

  // Featured seeds use upsert so they always reflect current data
  const upsertFeatured = db.prepare(`
    INSERT INTO markets
      (id, question, resolution_time, implied_prob_yes, implied_prob_no,
       total_pool, yes_pool, no_pool, updated_at)
    VALUES
      (@id, @question, @resolutionTime, @probYes, @probNo,
       @totalPool, @yesPool, @noPool, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      question = excluded.question,
      resolution_time = excluded.resolution_time,
      implied_prob_yes = excluded.implied_prob_yes,
      implied_prob_no = excluded.implied_prob_no,
      total_pool = excluded.total_pool,
      yes_pool = excluded.yes_pool,
      no_pool = excluded.no_pool,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  const defaultResolution = Math.floor(now / 1000) + 30 * 24 * 60 * 60;

  // Standard seed questions (INSERT OR IGNORE — won't overwrite on-chain data)
  for (const [idStr, question] of Object.entries(SEED_QUESTIONS)) {
    insert.run({
      id: Number(idStr),
      question,
      resolutionTime: defaultResolution,
      updatedAt: now,
    });
  }

  // Featured seeds (upsert — always stay fresh with rolling resolution times)
  for (const [idStr, feat] of Object.entries(FEATURED_SEEDS)) {
    const id = Number(idStr);
    const poolBig = BigInt(feat.poolWei);
    const yesPool = ((poolBig * BigInt(Math.round(feat.probYes * 1000))) / 1000n).toString();
    const noPool = (poolBig - BigInt(yesPool)).toString();

    upsertFeatured.run({
      id,
      question: feat.question,
      resolutionTime: Math.floor(now / 1000) + feat.hoursUntilResolution * 3600,
      probYes: feat.probYes,
      probNo: 1 - feat.probYes,
      totalPool: feat.poolWei,
      yesPool,
      noPool,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Prisma seed helper — mirrors SQLite seedMarkets for first-run Prisma path
// ---------------------------------------------------------------------------

let _prismaSeedDone = false;

async function seedMarketsPrisma(prisma: any): Promise<void> {
  if (_prismaSeedDone) return;
  _prismaSeedDone = true;

  const now = BigInt(Date.now());
  const defaultResolution = Math.floor(Number(now) / 1000) + 30 * 24 * 60 * 60;

  // Standard seed questions — createMany with skipDuplicates (like INSERT OR IGNORE)
  const seedRows = Object.entries(SEED_QUESTIONS).map(([idStr, question]) => ({
    id: Number(idStr),
    question,
    resolutionTime: defaultResolution,
    impliedProbYes: 0.5,
    impliedProbNo: 0.5,
    updatedAt: now,
  }));

  await prisma.marketCache.createMany({
    data: seedRows,
    skipDuplicates: true,
  });

  // Featured seeds — upsert so they always stay fresh
  for (const [idStr, feat] of Object.entries(FEATURED_SEEDS)) {
    const id = Number(idStr);
    const poolBig = BigInt(feat.poolWei);
    const yesPool = ((poolBig * BigInt(Math.round(feat.probYes * 1000))) / 1000n).toString();
    const noPool = (poolBig - BigInt(yesPool)).toString();
    const resTime = Math.floor(Number(now) / 1000) + feat.hoursUntilResolution * 3600;

    await prisma.marketCache.upsert({
      where: { id },
      update: {
        question: feat.question,
        resolutionTime: resTime,
        impliedProbYes: feat.probYes,
        impliedProbNo: 1 - feat.probYes,
        totalPool: feat.poolWei,
        yesPool,
        noPool,
        updatedAt: now,
      },
      create: {
        id,
        question: feat.question,
        resolutionTime: resTime,
        impliedProbYes: feat.probYes,
        impliedProbNo: 1 - feat.probYes,
        totalPool: feat.poolWei,
        yesPool,
        noPool,
        updatedAt: now,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Prisma row <-> PersistedMarketSnapshot converters
// ---------------------------------------------------------------------------

function prismaRowToSnapshot(row: any): PersistedMarketSnapshot {
  return {
    id: row.id,
    address: row.address,
    questionHash: row.questionHash,
    question: row.question,
    resolutionTime: row.resolutionTime,
    oracle: row.oracle,
    collateralToken: row.collateralToken,
    feeBps: row.feeBps,
    status: row.status,
    totalPool: row.totalPool,
    yesPool: row.yesPool,
    noPool: row.noPool,
    impliedProbYes: row.impliedProbYes,
    impliedProbNo: row.impliedProbNo,
    winningOutcome: row.winningOutcome ?? undefined,
    tradeCount: row.tradeCount,
    updatedAt: Number(row.updatedAt),
    source: row.source ?? "onchain",
    category: row.category ?? undefined,
    slug: row.slug ?? undefined,
    imageUrl: row.imageUrl ?? undefined,
    volume24h: row.volume24h ?? undefined,
    liquidity: row.liquidity ?? undefined,
    description: row.description ?? undefined,
    outcomes: row.outcomes ?? undefined,
    oneDayChange: row.oneDayChange ?? undefined,
    polymarketUrl: row.polymarketUrl ?? undefined,
  };
}

function rowToSnapshot(row: any): PersistedMarketSnapshot {
  return {
    id: row.id,
    address: row.address,
    questionHash: row.question_hash,
    question: row.question,
    resolutionTime: row.resolution_time,
    oracle: row.oracle,
    collateralToken: row.collateral_token,
    feeBps: row.fee_bps,
    status: row.status,
    totalPool: row.total_pool,
    yesPool: row.yes_pool,
    noPool: row.no_pool,
    impliedProbYes: row.implied_prob_yes,
    impliedProbNo: row.implied_prob_no,
    winningOutcome: row.winning_outcome ?? undefined,
    tradeCount: row.trade_count,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Market CRUD
// ---------------------------------------------------------------------------

export async function upsertMarkets(snapshots: PersistedMarketSnapshot[]): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await seedMarketsPrisma(prisma);

      for (const s of snapshots) {
        const isPlaceholder = !s.question || /^Market #\d+/.test(s.question);

        if (isPlaceholder) {
          // If incoming question is empty/placeholder, preserve existing question
          const existing = await prisma.marketCache.findUnique({ where: { id: s.id } });
          const preservedQuestion =
            existing && existing.question && existing.question !== "" && !/^Market #/.test(existing.question)
              ? existing.question
              : s.question;

          await prisma.marketCache.upsert({
            where: { id: s.id },
            update: {
              address: s.address,
              questionHash: s.questionHash,
              question: preservedQuestion,
              resolutionTime: s.resolutionTime,
              oracle: s.oracle,
              collateralToken: s.collateralToken,
              feeBps: s.feeBps,
              status: s.status,
              totalPool: s.totalPool,
              yesPool: s.yesPool,
              noPool: s.noPool,
              impliedProbYes: s.impliedProbYes,
              impliedProbNo: s.impliedProbNo,
              winningOutcome: s.winningOutcome ?? null,
              tradeCount: s.tradeCount ?? 0,
              updatedAt: BigInt(s.updatedAt),
            },
            create: {
              id: s.id,
              address: s.address,
              questionHash: s.questionHash,
              question: preservedQuestion,
              resolutionTime: s.resolutionTime,
              oracle: s.oracle,
              collateralToken: s.collateralToken,
              feeBps: s.feeBps,
              status: s.status,
              totalPool: s.totalPool,
              yesPool: s.yesPool,
              noPool: s.noPool,
              impliedProbYes: s.impliedProbYes,
              impliedProbNo: s.impliedProbNo,
              winningOutcome: s.winningOutcome ?? null,
              tradeCount: s.tradeCount ?? 0,
              updatedAt: BigInt(s.updatedAt),
            },
          });
        } else {
          await prisma.marketCache.upsert({
            where: { id: s.id },
            update: {
              address: s.address,
              questionHash: s.questionHash,
              question: s.question,
              resolutionTime: s.resolutionTime,
              oracle: s.oracle,
              collateralToken: s.collateralToken,
              feeBps: s.feeBps,
              status: s.status,
              totalPool: s.totalPool,
              yesPool: s.yesPool,
              noPool: s.noPool,
              impliedProbYes: s.impliedProbYes,
              impliedProbNo: s.impliedProbNo,
              winningOutcome: s.winningOutcome ?? null,
              tradeCount: s.tradeCount ?? 0,
              updatedAt: BigInt(s.updatedAt),
            },
            create: {
              id: s.id,
              address: s.address,
              questionHash: s.questionHash,
              question: s.question,
              resolutionTime: s.resolutionTime,
              oracle: s.oracle,
              collateralToken: s.collateralToken,
              feeBps: s.feeBps,
              status: s.status,
              totalPool: s.totalPool,
              yesPool: s.yesPool,
              noPool: s.noPool,
              impliedProbYes: s.impliedProbYes,
              impliedProbNo: s.impliedProbNo,
              winningOutcome: s.winningOutcome ?? null,
              tradeCount: s.tradeCount ?? 0,
              updatedAt: BigInt(s.updatedAt),
            },
          });
        }
      }
      return;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO markets
        (id, address, question_hash, question, resolution_time, oracle,
         collateral_token, fee_bps, status, total_pool, yes_pool, no_pool,
         implied_prob_yes, implied_prob_no, winning_outcome, trade_count, updated_at)
      VALUES
        (@id, @address, @questionHash, @question, @resolutionTime, @oracle,
         @collateralToken, @feeBps, @status, @totalPool, @yesPool, @noPool,
         @impliedProbYes, @impliedProbNo, @winningOutcome, @tradeCount, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        address = excluded.address,
        question_hash = excluded.question_hash,
        question = CASE
          WHEN excluded.question LIKE 'Market #%' OR excluded.question = ''
          THEN COALESCE(NULLIF(markets.question, ''), excluded.question)
          ELSE excluded.question
        END,
        resolution_time = excluded.resolution_time,
        oracle = excluded.oracle,
        collateral_token = excluded.collateral_token,
        fee_bps = excluded.fee_bps,
        status = excluded.status,
        total_pool = excluded.total_pool,
        yes_pool = excluded.yes_pool,
        no_pool = excluded.no_pool,
        implied_prob_yes = excluded.implied_prob_yes,
        implied_prob_no = excluded.implied_prob_no,
        winning_outcome = excluded.winning_outcome,
        trade_count = excluded.trade_count,
        updated_at = excluded.updated_at
    `);

    for (const s of snapshots) {
      upsert.run({
        id: s.id,
        address: s.address,
        questionHash: s.questionHash,
        question: s.question,
        resolutionTime: s.resolutionTime,
        oracle: s.oracle,
        collateralToken: s.collateralToken,
        feeBps: s.feeBps,
        status: s.status,
        totalPool: s.totalPool,
        yesPool: s.yesPool,
        noPool: s.noPool,
        impliedProbYes: s.impliedProbYes,
        impliedProbNo: s.impliedProbNo,
        winningOutcome: s.winningOutcome ?? null,
        tradeCount: s.tradeCount ?? 0,
        updatedAt: s.updatedAt,
      });
    }
  } catch {
    // SQLite may be unavailable on Vercel (ephemeral FS)
  }
}

export async function getAllMarkets(): Promise<PersistedMarketSnapshot[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await seedMarketsPrisma(prisma);
      const rows = await prisma.marketCache.findMany({ orderBy: { id: "asc" } });
      return rows.map(prismaRowToSnapshot);
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM markets ORDER BY id ASC").all();
    return rows.map(rowToSnapshot);
  } catch {
    return [];
  }
}

export async function getMarketByIdFromDb(
  id: number
): Promise<PersistedMarketSnapshot | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await seedMarketsPrisma(prisma);
      const row = await prisma.marketCache.findUnique({ where: { id } });
      return row ? prismaRowToSnapshot(row) : null;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM markets WHERE id = ?").get(id);
    return row ? rowToSnapshot(row) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Predictions CRUD
// ---------------------------------------------------------------------------

export async function upsertPredictions(
  marketId: number,
  predictions: DbAgentPrediction[]
): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const now = BigInt(Date.now());
      for (const p of predictions) {
        const mid = p.marketId ?? marketId;
        await prisma.agentPrediction.upsert({
          where: {
            agent_marketId: { agent: p.agent, marketId: mid },
          },
          update: {
            predictedProb: p.predictedProb,
            brierScore: p.brierScore,
            predictionCount: p.predictionCount,
            updatedAt: now,
          },
          create: {
            agent: p.agent,
            marketId: mid,
            predictedProb: p.predictedProb,
            brierScore: p.brierScore,
            predictionCount: p.predictionCount,
            updatedAt: now,
          },
        });
      }
      return;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO predictions (agent, market_id, predicted_prob, brier_score, prediction_count, updated_at)
      VALUES (@agent, @marketId, @predictedProb, @brierScore, @predictionCount, @updatedAt)
      ON CONFLICT(agent, market_id) DO UPDATE SET
        predicted_prob = excluded.predicted_prob,
        brier_score = excluded.brier_score,
        prediction_count = excluded.prediction_count,
        updated_at = excluded.updated_at
    `);

    const now = Date.now();
    for (const p of predictions) {
      upsert.run({
        agent: p.agent,
        marketId: p.marketId ?? marketId,
        predictedProb: p.predictedProb,
        brierScore: p.brierScore,
        predictionCount: p.predictionCount,
        updatedAt: now,
      });
    }
  } catch {
    // SQLite may be unavailable on Vercel (ephemeral FS)
  }
}

export async function getPredictionsFromDb(marketId: number): Promise<DbAgentPrediction[]> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const rows = await prisma.agentPrediction.findMany({
        where: { marketId },
      });
      return rows.map((row: any) => ({
        agent: row.agent,
        marketId: row.marketId,
        predictedProb: row.predictedProb,
        brierScore: row.brierScore,
        predictionCount: row.predictionCount,
      }));
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM predictions WHERE market_id = ?")
      .all(marketId) as any[];

    return rows.map((row) => ({
      agent: row.agent,
      marketId: row.market_id,
      predictedProb: row.predicted_prob,
      brierScore: row.brier_score,
      predictionCount: row.prediction_count,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Weighted Probability CRUD
// ---------------------------------------------------------------------------

export async function upsertWeightedProb(
  marketId: number,
  prob: number
): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.weightedProb.upsert({
        where: { marketId },
        update: {
          weightedProb: prob,
          updatedAt: BigInt(Date.now()),
        },
        create: {
          marketId,
          weightedProb: prob,
          updatedAt: BigInt(Date.now()),
        },
      });
      return;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO weighted_probs (market_id, weighted_prob, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(market_id) DO UPDATE SET
        weighted_prob = excluded.weighted_prob,
        updated_at = excluded.updated_at
    `).run(marketId, prob, Date.now());
  } catch {
    // SQLite may be unavailable on Vercel (ephemeral FS)
  }
}

export async function getWeightedProbFromDb(marketId: number): Promise<number | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.weightedProb.findUnique({
        where: { marketId },
      });
      return row ? row.weightedProb : null;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT weighted_prob FROM weighted_probs WHERE market_id = ?")
      .get(marketId) as any;
    return row ? row.weighted_prob : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent Takes CRUD
// ---------------------------------------------------------------------------

export async function upsertAgentTake(take: DbAgentTake): Promise<void> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.agentTake.upsert({
        where: {
          marketId_agentName: {
            marketId: take.marketId,
            agentName: take.agentName,
          },
        },
        update: {
          probability: take.probability,
          reasoning: take.reasoning,
          timestamp: BigInt(take.timestamp),
        },
        create: {
          marketId: take.marketId,
          agentName: take.agentName,
          probability: take.probability,
          reasoning: take.reasoning,
          timestamp: BigInt(take.timestamp),
        },
      });
      return;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO agent_takes (market_id, agent_name, probability, reasoning, timestamp)
      VALUES (@marketId, @agentName, @probability, @reasoning, @timestamp)
      ON CONFLICT(market_id, agent_name) DO UPDATE SET
        probability = excluded.probability,
        reasoning = excluded.reasoning,
        timestamp = excluded.timestamp
    `).run({
      marketId: take.marketId,
      agentName: take.agentName,
      probability: take.probability,
      reasoning: take.reasoning,
      timestamp: take.timestamp,
    });
  } catch {
    // SQLite may be unavailable on Vercel (ephemeral FS)
  }
}

/**
 * Persist a market's question text.
 * Uses INSERT OR IGNORE + UPDATE so it works for both new and existing rows.
 */
export async function registerMarketQuestion(id: number, question: string): Promise<void> {
  if (!question || !question.trim()) return;

  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const trimmed = question.trim();
      const existing = await prisma.marketCache.findUnique({ where: { id } });

      if (!existing) {
        await prisma.marketCache.create({
          data: {
            id,
            question: trimmed,
            updatedAt: BigInt(Date.now()),
          },
        });
      } else if (
        existing.question === "" ||
        /^Market #/.test(existing.question)
      ) {
        await prisma.marketCache.update({
          where: { id },
          data: {
            question: trimmed,
            updatedAt: BigInt(Date.now()),
          },
        });
      }
      return;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    // Ensure row exists
    db.prepare(
      `INSERT OR IGNORE INTO markets (id, question, updated_at) VALUES (?, ?, ?)`
    ).run(id, question.trim(), Date.now());
    // Update question if row already existed with empty/placeholder text
    db.prepare(
      `UPDATE markets SET question = ?, updated_at = ? WHERE id = ? AND (question = '' OR question LIKE 'Market #%')`
    ).run(question.trim(), Date.now(), id);
  } catch {
    // SQLite may be unavailable on Vercel (ephemeral FS)
  }
}

/**
 * Get all non-empty questions for hydrating MARKET_QUESTIONS.
 */
export async function getAllMarketQuestions(): Promise<Array<{ id: number; question: string }>> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      await seedMarketsPrisma(prisma);
      const rows = await prisma.marketCache.findMany({
        where: {
          question: { not: "" },
          NOT: { question: { startsWith: "Market #" } },
        },
        select: { id: true, question: true },
      });
      return rows;
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    return db
      .prepare(
        "SELECT id, question FROM markets WHERE question != '' AND question NOT LIKE 'Market #%'"
      )
      .all() as Array<{ id: number; question: string }>;
  } catch {
    return [];
  }
}

export async function getLatestAgentTakeFromDb(
  marketId: number
): Promise<{ agentName: string; probability: number; reasoning: string; timestamp: number } | null> {
  if (usePrismaRuntime()) {
    const prisma = await getPrismaClient();
    if (prisma) {
      const row = await prisma.agentTake.findFirst({
        where: { marketId },
        orderBy: { timestamp: "desc" },
      });
      if (!row) return null;
      return {
        agentName: row.agentName,
        probability: row.probability,
        reasoning: row.reasoning,
        timestamp: Number(row.timestamp),
      };
    }
  }

  // --- SQLite fallback ---
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT * FROM agent_takes WHERE market_id = ? ORDER BY timestamp DESC LIMIT 1"
      )
      .get(marketId) as any;

    if (!row) return null;

    return {
      agentName: row.agent_name,
      probability: row.probability,
      reasoning: row.reasoning,
      timestamp: row.timestamp,
    };
  } catch {
    return null;
  }
}
