import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, getAnalyticsOverviewMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  getAnalyticsOverviewMock: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/ops-store", () => ({
  getAnalyticsOverview: getAnalyticsOverviewMock,
}));

import { GET } from "./route.ts";

describe("analytics overview API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces RBAC boundary", async () => {
    requireRoleMock.mockReturnValue(null);

    const response = await GET({} as any);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(getAnalyticsOverviewMock).not.toHaveBeenCalled();
  });

  it("scopes analytics by organization membership", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "u_1" },
      membership: { organizationId: "org_alpha", role: "viewer" },
    });
    getAnalyticsOverviewMock.mockResolvedValue({
      calibration: [],
      brierTimeline: [],
      sourceAttribution: [],
      sourceReliability: [],
      agentCalibration: [],
      forecastQuality: {
        avgBrier: 0,
        avgLogLoss: 0,
        sharpness: 0,
        calibrationGap: 0,
        brierSkillScore: 0,
      },
      strategy: {
        totalExecutions: 0,
        successRate: 0,
        deployedCapitalStrk: 0,
        realizedPnlStrk: 0,
        bySurface: [],
      },
    });

    const response = await GET({} as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getAnalyticsOverviewMock).toHaveBeenCalledWith("org_alpha");
    expect(body.organizationId).toBe("org_alpha");
  });
});
