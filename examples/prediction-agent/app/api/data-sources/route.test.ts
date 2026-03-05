import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  quickResearchMock,
  checkRateLimitMock,
  getSourceReliabilityProfileMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  quickResearchMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  getSourceReliabilityProfileMock: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/research-agent", () => ({
  quickResearch: quickResearchMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock("@/lib/ops-store", () => ({
  getSourceReliabilityProfile: getSourceReliabilityProfileMock,
}));

import { GET } from "./route.ts";

describe("data sources API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 10 });
    quickResearchMock.mockResolvedValue([]);
    getSourceReliabilityProfileMock.mockResolvedValue({});
  });

  it("enforces viewer role", async () => {
    requireRoleMock.mockReturnValue(null);

    const response = await GET({
      nextUrl: new URL("http://localhost/api/data-sources?question=Will ETH rise?"),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(quickResearchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });
    checkRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 15_000 });

    const response = await GET({
      nextUrl: new URL("http://localhost/api/data-sources?question=Will ETH rise?"),
    } as any);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
    expect(quickResearchMock).not.toHaveBeenCalled();
  });

  it("validates question length", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });

    const response = await GET({
      nextUrl: new URL("http://localhost/api/data-sources?question=bad"),
    } as any);

    expect(response.status).toBe(400);
    expect(quickResearchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid source filters", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });

    const response = await GET({
      nextUrl: new URL(
        "http://localhost/api/data-sources?question=Will%20ETH%20rise%20this%20quarter%3F&sources=unknown"
      ),
    } as any);

    expect(response.status).toBe(400);
    expect(quickResearchMock).not.toHaveBeenCalled();
  });

  it("passes normalized inputs to research layer", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });
    quickResearchMock.mockResolvedValue([{ source: "news" }]);

    const response = await GET({
      nextUrl: new URL(
        "http://localhost/api/data-sources?question=%20Will%20ETH%20rise%20this%20quarter%3F%20&sources=news,social"
      ),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.question).toBe("Will ETH rise this quarter?");
    expect(quickResearchMock).toHaveBeenCalledWith("Will ETH rise this quarter?", [
      "news",
      "social",
    ]);
  });

  it("attaches source backtests when available", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });
    quickResearchMock.mockResolvedValue([{ source: "news", data: [], summary: "x" }]);
    getSourceReliabilityProfileMock.mockResolvedValue({
      news: {
        source: "news",
        samples: 10,
        markets: 4,
        avgBrier: 0.2,
        calibrationBias: 0.01,
        reliabilityScore: 0.71,
        confidence: 0.5,
      },
    });

    const response = await GET({
      nextUrl: new URL(
        "http://localhost/api/data-sources?question=Will%20ETH%20rise%20this%20quarter%3F&sources=news"
      ),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].backtest.reliabilityScore).toBe(0.71);
  });
});
