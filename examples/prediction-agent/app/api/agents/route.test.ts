import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  listMock,
  spawnMock,
  serializeAgentMock,
  recordAuditMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  listMock: vi.fn(),
  spawnMock: vi.fn(),
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
    list: listMock,
    spawn: spawnMock,
  },
  serializeAgent: serializeAgentMock,
}));

import { GET, POST } from "./route.ts";

describe("agents API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAuditMock.mockResolvedValue(undefined);
  });

  it("enforces viewer role for GET", async () => {
    requireRoleMock.mockReturnValue(null);

    const response = await GET({} as any);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns agent list when authorized", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "viewer" },
    });
    listMock.mockReturnValue([{ id: "agent_1" }, { id: "agent_2" }]);
    serializeAgentMock.mockImplementation((agent) => ({ id: agent.id }));

    const response = await GET({} as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.agents).toEqual([{ id: "agent_1" }, { id: "agent_2" }]);
  });

  it("enforces admin role for POST", async () => {
    requireRoleMock.mockReturnValue(null);

    const response = await POST(
      { json: async () => ({ name: "Agent A" }) } as any
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects invalid spawn payloads", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "admin" },
    });

    const response = await POST(
      { json: async () => ({ name: "a" }) } as any
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(Array.isArray(body.error)).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns agent and records audit event", async () => {
    requireRoleMock.mockReturnValue({
      user: { id: "usr_1" },
      membership: { organizationId: "org_1", role: "admin" },
    });
    const spawned = { id: "agent_1", name: "Agent A" };
    spawnMock.mockReturnValue(spawned);
    serializeAgentMock.mockReturnValue({ id: "agent_1", name: "Agent A" });

    const response = await POST(
      {
        json: async () => ({
          name: "Agent A",
          personaId: "alpha",
          budgetStrk: 500,
          maxBetStrk: 25,
          preferredSources: ["news", "social"],
        }),
      } as any
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Agent A",
        personaId: "alpha",
      })
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        userId: "usr_1",
        action: "agent.spawn",
        targetId: "agent_1",
      })
    );
  });
});
