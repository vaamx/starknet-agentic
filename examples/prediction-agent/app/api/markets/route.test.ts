import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  getMarketsMock,
  createMarketMock,
  recordTradeExecutionMock,
  recordAuditMock,
  setMarketQuestionMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  getMarketsMock: vi.fn(),
  createMarketMock: vi.fn(),
  recordTradeExecutionMock: vi.fn(),
  recordAuditMock: vi.fn(),
  setMarketQuestionMock: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/market-quality", () => ({
  reviewMarketQuestion: (question: string) => {
    const normalized = question.trim();
    if (normalized.toLowerCase().includes("soon")) {
      return {
        normalizedQuestion: normalized,
        score: 40,
        issues: ["Question is too ambiguous"],
        warnings: [],
        isBinary: false,
        hasTimeBound: false,
        categoryHint: "crypto",
      };
    }
    return {
      normalizedQuestion: normalized,
      score: 82,
      issues: [],
      warnings: [],
      isBinary: true,
      hasTimeBound: true,
      categoryHint: "crypto",
    };
  },
}));

vi.mock("@/lib/market-reader", () => ({
  getMarkets: getMarketsMock,
  DEMO_QUESTIONS: {
    1: "Will ETH close above $6,000 by December 31, 2026?",
  },
  setMarketQuestion: setMarketQuestionMock,
}));

vi.mock("@/lib/starknet-executor", () => ({
  createMarket: createMarketMock,
}));

vi.mock("@/lib/ops-store", () => ({
  recordTradeExecution: recordTradeExecutionMock,
  recordAudit: recordAuditMock,
}));

import { POST } from "./route.ts";

describe("markets API create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKET_ORACLE_ADDRESS = "0x1234";
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "admin" },
    });
    createMarketMock.mockResolvedValue({
      status: "success",
      txHash: "0xabc",
      executionSurface: "direct",
    });
    getMarketsMock.mockResolvedValue([]);
  });

  it("rejects low-quality questions", async () => {
    const response = await POST({
      json: async () => ({
        question: "ETH soon?",
        days: 30,
        feeBps: 200,
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Market question quality check failed");
    expect(createMarketMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate questions", async () => {
    const response = await POST({
      json: async () => ({
        question: "Will ETH close above $6,000 by December 31, 2026?",
        days: 30,
        feeBps: 200,
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("already exists");
    expect(createMarketMock).not.toHaveBeenCalled();
  });

  it("creates market for valid payload", async () => {
    getMarketsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await POST({
      json: async () => ({
        question: "Will BTC close above $150,000 by December 31, 2026?",
        days: 180,
        feeBps: 150,
        category: "crypto",
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createMarketMock).toHaveBeenCalledTimes(1);
    expect(recordTradeExecutionMock).toHaveBeenCalledTimes(1);
    expect(body.marketQuality.score).toBeGreaterThan(60);
  });
});
