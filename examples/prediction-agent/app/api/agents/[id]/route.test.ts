import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  getAgentMock,
  stopMock,
  pauseMock,
  resumeMock,
  removeMock,
  serializeAgentMock,
  recordAuditMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  getAgentMock: vi.fn(),
  stopMock: vi.fn(),
  pauseMock: vi.fn(),
  resumeMock: vi.fn(),
  removeMock: vi.fn(),
  serializeAgentMock: vi.fn(),
  recordAuditMock: vi.fn(),
}));

vi.mock("@/lib/require-auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/ops-store", () => ({
  recordAudit: recordAuditMock,
}));

vi.mock("@/lib/agent-spawner", () => ({
  agentSpawner: {
    getAgent: getAgentMock,
    stop: stopMock,
    pause: pauseMock,
    resume: resumeMock,
    remove: removeMock,
  },
  serializeAgent: serializeAgentMock,
}));

import { DELETE, GET, POST } from "./route.ts";

describe("single agent API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAuditMock.mockResolvedValue(undefined);
  });

  it("enforces viewer role for GET", async () => {
    requireRoleMock.mockReturnValue(null);

    const response = await GET(
      {} as any,
      { params: Promise.resolve({ id: "agent_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(getAgentMock).not.toHaveBeenCalled();
  });

  it("returns 404 when agent does not exist", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });
    getAgentMock.mockReturnValue(null);

    const response = await GET(
      {} as any,
      { params: Promise.resolve({ id: "missing" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Agent not found");
  });

  it("controls agent lifecycle when admin", async () => {
    const agent = { id: "agent_1", name: "Agent A", status: "running" };
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "admin" },
    });
    getAgentMock.mockImplementation(() => agent);
    pauseMock.mockImplementation(() => {
      agent.status = "paused";
    });
    serializeAgentMock.mockImplementation((a) => ({ id: a.id, status: a.status }));

    const response = await POST(
      { json: async () => ({ action: "pause" }) } as any,
      { params: Promise.resolve({ id: "agent_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(pauseMock).toHaveBeenCalledWith("agent_1");
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        userId: "usr_1",
        action: "agent.pause",
        targetId: "agent_1",
      })
    );
  });

  it("rejects invalid control actions", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "admin" },
    });
    getAgentMock.mockReturnValue({ id: "agent_1", name: "Agent A", status: "running" });

    const response = await POST(
      { json: async () => ({ action: "invalid" }) } as any,
      { params: Promise.resolve({ id: "agent_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(Array.isArray(body.error)).toBe(true);
  });

  it("removes agent and audits deletion", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "admin" },
    });
    getAgentMock.mockReturnValue({ id: "agent_1", name: "Agent A", status: "running" });

    const response = await DELETE(
      {} as any,
      { params: Promise.resolve({ id: "agent_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(removeMock).toHaveBeenCalledWith("agent_1");
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        userId: "usr_1",
        action: "agent.remove",
        targetId: "agent_1",
      })
    );
  });
});
