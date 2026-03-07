import { NextRequest, NextResponse } from "next/server";
import { getTaskDetail } from "@/lib/economy-reader";

export const runtime = "nodejs";

// Mock fallback detail data
const MOCK_TASKS: Record<string, object> = {
  "1": {
    taskId: "1",
    descriptionHash: "0x7f3a91c4d8e2b05f6a1c0d94e87b5c32af610de47289c35b10fa4d8e6b92c1a3",
    description: "Deploy ERC-8004 identity registry on Starknet mainnet and verify all metadata keys.",
    status: "open",
    rewardStrk: 250,
    poster: "0x04a8bc7e5d21f0893c6e0df24a7b63d91e5f72ab0c3d18e46f9a20b537c8d1e6",
    assignee: null,
    deadline: Math.floor(Date.now() / 1000) + 86400 * 7,
    requiredValidators: 2,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 2,
    proofHash: null,
    proofSubmittedAt: null,
    bids: [
      { bidder: "0x06d1f3a9b42c57e80f93a26d4b0e15c78f93d20a61b4e98f73c52d10a6b49e83", amount: 230, timestamp: Math.floor(Date.now() / 1000) - 86400, message: "Experienced with ERC-8004 deployments." },
      { bidder: "0x08f3b5c1d64e79a02b15c48f6d2a37e90b15f42c83d6a10b95e74f32c8d61a05", amount: 250, timestamp: Math.floor(Date.now() / 1000) - 43200, message: "Full-stack Cairo dev." },
    ],
    timeline: [
      { action: "Task Created", actor: "0x04a8bc7e5d21f0893c6e0df24a7b63d91e5f72ab0c3d18e46f9a20b537c8d1e6", timestamp: Math.floor(Date.now() / 1000) - 86400 * 2, detail: "250 STRK escrowed" },
    ],
  },
  "5": {
    taskId: "5",
    descriptionHash: "0xd4e5f60718293a4bc5d6e7f800910213d4e5f60718293a4bc5d6e7f800910213",
    description: "Audit the x402-starknet SNIP-12 signing flow for replay attack vulnerabilities.",
    status: "disputed",
    rewardStrk: 750,
    poster: "0x0bc6e8f4a97b02d35e48f71ca5d60b23e48c75fb6a9d43ecb8ba7c65fbaa4d38",
    assignee: "0x0cd7f9a5b08c13e46f59a82db6e71c34f59d86ac7bae54fdc9cb8d76acbb5e49",
    deadline: Math.floor(Date.now() / 1000) - 86400 * 3,
    requiredValidators: 3,
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 15,
    proofHash: "0x91a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80",
    proofSubmittedAt: Math.floor(Date.now() / 1000) - 86400 * 4,
    bids: [
      { bidder: "0x0cd7f9a5b08c13e46f59a82db6e71c34f59d86ac7bae54fdc9cb8d76acbb5e49", amount: 700, timestamp: Math.floor(Date.now() / 1000) - 86400 * 12, message: "Security researcher." },
    ],
    timeline: [
      { action: "Task Created", actor: "0x0bc6e8f4a97b02d35e48f71ca5d60b23e48c75fb6a9d43ecb8ba7c65fbaa4d38", timestamp: Math.floor(Date.now() / 1000) - 86400 * 15, detail: "750 STRK escrowed" },
      { action: "Dispute Raised", actor: "0x0bc6e8f4a97b02d35e48f71ca5d60b23e48c75fb6a9d43ecb8ba7c65fbaa4d38", timestamp: Math.floor(Date.now() / 1000) - 86400 * 3, detail: "Incomplete coverage" },
    ],
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const numericId = parseInt(taskId, 10);

  // Try on-chain first (for numeric IDs)
  if (!isNaN(numericId)) {
    try {
      const task = await getTaskDetail(numericId);
      if (task) {
        return NextResponse.json({
          ...task,
          // On-chain doesn't store descriptions — signal to frontend
          description: null,
          proofSubmittedAt: null,
          timeline: [],
          source: "onchain",
        });
      }
    } catch {
      // Fall through to mock
    }
  }

  // Mock fallback
  const task = MOCK_TASKS[taskId];
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ ...task as any, source: "mock" });
}
