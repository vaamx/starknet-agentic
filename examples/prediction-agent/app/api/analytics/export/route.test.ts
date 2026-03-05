import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.fn();
const listRecentForecastsMock = vi.fn();
const listRecentResearchArtifactsMock = vi.fn();
const listRecentExecutionsMock = vi.fn();

vi.mock("@/lib/require-auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/ops-store", () => ({
  listRecentForecasts: listRecentForecastsMock,
  listRecentResearchArtifacts: listRecentResearchArtifactsMock,
  listRecentExecutions: listRecentExecutionsMock,
}));

import { GET } from "./route";

describe("analytics export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces RBAC boundary", async () => {
    requireRoleMock.mockReturnValue(null);

    const response = await GET({
      nextUrl: new URL("http://localhost/api/analytics/export?dataset=forecasts"),
    } as any);

    expect(response.status).toBe(403);
    expect(listRecentForecastsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid dataset", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "u_1" },
      membership: { organizationId: "org_alpha", role: "viewer" },
    });

    const response = await GET({
      nextUrl: new URL("http://localhost/api/analytics/export?dataset=unknown"),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid dataset");
  });

  it("scopes export rows by organization", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "u_1" },
      membership: { organizationId: "org_alpha", role: "viewer" },
    });
    listRecentExecutionsMock.mockResolvedValue([
      {
        id: "exec_1",
        marketId: 1,
        status: "success",
      },
    ]);

    const response = await GET({
      nextUrl: new URL("http://localhost/api/analytics/export?dataset=executions&limit=25"),
    } as any);
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(listRecentExecutionsMock).toHaveBeenCalledWith("org_alpha", 25);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(csv).toContain("id,marketId,status");
    expect(csv).toContain("exec_1,1,success");
  });
});
