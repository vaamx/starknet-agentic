import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/economy-reader";

export const runtime = "nodejs";

// Mock fallback — used when on-chain task count is 0
const MOCK_TASKS = [
  {
    taskId: "1",
    descriptionHash: "0x7f3a91c4d8e2b05f6a1c0d94e87b5c32af610de47289c35b10fa4d8e6b92c1a3",
    description: "Deploy ERC-8004 identity registry on Starknet mainnet and verify all metadata keys.",
    status: "open",
    rewardStrk: 250,
    poster: "0x04a8bc7e5d21f0893c6e0df24a7b63d91e5f72ab0c3d18e46f9a20b537c8d1e6",
    assignee: null,
    deadline: Math.floor(Date.now() / 1000) + 86400 * 7,
    bidsCount: 3,
    requiredValidators: 2,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 2,
  },
  {
    taskId: "2",
    descriptionHash: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    description: "Build Avnu swap aggregation module for the MCP server with Sepolia test coverage.",
    status: "assigned",
    rewardStrk: 500,
    poster: "0x05c9e2f8a31b46d70e82f15c3a9d04b67e82c19f50a3d87e62b41c09f5a38d72",
    assignee: "0x06d1f3a9b42c57e80f93a26d4b0e15c78f93d20a61b4e98f73c52d10a6b49e83",
    deadline: Math.floor(Date.now() / 1000) + 86400 * 5,
    bidsCount: 5,
    requiredValidators: 3,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 4,
  },
  {
    taskId: "3",
    descriptionHash: "0xb2c3d4e5f6071829a3b4c5d6e7f80091b2c3d4e5f6071829a3b4c5d6e7f80091",
    description: "Write comprehensive snforge test suite for AgentAccount session key rotation logic.",
    status: "submitted",
    rewardStrk: 180,
    poster: "0x07e2a4b0c53d68f91a04b37e5c1f26d89a04e31b72c5f09a84d63e21b7c50f94",
    assignee: "0x08f3b5c1d64e79a02b15c48f6d2a37e90b15f42c83d6a10b95e74f32c8d61a05",
    deadline: Math.floor(Date.now() / 1000) + 86400 * 2,
    bidsCount: 2,
    requiredValidators: 2,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 8,
  },
  {
    taskId: "4",
    descriptionHash: "0xc3d4e5f607182930b4c5d6e7f8009102c3d4e5f607182930b4c5d6e7f8009102",
    description: "Integrate Tavily web search as a data source for the prediction agent research pipeline.",
    status: "approved",
    rewardStrk: 320,
    poster: "0x09a4c6d2e75f80b13c26d59a7e3b48f01c26a53d94e7b21ca6f85a43d9e72b16",
    assignee: "0x0ab5d7e3f86a91c24d37e60b8f4c59a12d37b64ea5f8c32db7a96b54eaf83c27",
    deadline: Math.floor(Date.now() / 1000) - 86400,
    bidsCount: 4,
    requiredValidators: 2,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 12,
  },
  {
    taskId: "5",
    descriptionHash: "0xd4e5f60718293a4bc5d6e7f800910213d4e5f60718293a4bc5d6e7f800910213",
    description: "Audit the x402-starknet SNIP-12 signing flow for replay attack vulnerabilities.",
    status: "disputed",
    rewardStrk: 750,
    poster: "0x0bc6e8f4a97b02d35e48f71ca5d60b23e48c75fb6a9d43ecb8ba7c65fbaa4d38",
    assignee: "0x0cd7f9a5b08c13e46f59a82db6e71c34f59d86ac7bae54fdc9cb8d76acbb5e49",
    deadline: Math.floor(Date.now() / 1000) - 86400 * 3,
    bidsCount: 6,
    requiredValidators: 3,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 15,
  },
  {
    taskId: "6",
    descriptionHash: "0xe5f60718293a4b5cd6e7f8009102134ae5f60718293a4b5cd6e7f8009102134a",
    description: "Create a cross-chain bridge monitoring skill for Base Sepolia to Starknet transfers.",
    status: "cancelled",
    rewardStrk: 400,
    poster: "0x0de8a0b6c19d24f57a6ab93ec7f82d45a6ae97bd8cbf65aedadc9e87bdcc6f5a",
    assignee: null,
    deadline: Math.floor(Date.now() / 1000) - 86400 * 5,
    bidsCount: 1,
    requiredValidators: 2,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 20,
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  // Try on-chain first
  try {
    const result = await listTasks(offset, limit, status);
    if (result.total > 0) {
      return NextResponse.json({
        tasks: result.tasks,
        total: result.total,
        offset,
        limit,
        source: "onchain",
      });
    }
  } catch {
    // Fall through to mock
  }

  // Mock fallback
  let tasks = [...MOCK_TASKS];
  if (status && status !== "all") {
    tasks = tasks.filter((t) => t.status === status);
  }
  const total = tasks.length;
  tasks = tasks.slice(offset, offset + limit);

  return NextResponse.json({ tasks, total, offset, limit, source: "mock" });
}
