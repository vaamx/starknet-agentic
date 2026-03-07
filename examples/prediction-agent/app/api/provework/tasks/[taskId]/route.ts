import { NextRequest, NextResponse } from "next/server";
import { shortString } from "starknet";
import { getTaskDetail } from "@/lib/economy-reader";

export const runtime = "nodejs";

/** Try to decode a felt252 hex description hash as a readable short string. */
function tryDecodeDescription(hash: string): string | null {
  try {
    const decoded = shortString.decodeShortString(hash);
    // If it decodes to printable text (not garbage), use it
    if (decoded && /^[\x20-\x7E]+$/.test(decoded) && decoded.length > 1) {
      return decoded;
    }
  } catch {
    // not a valid short string
  }
  return null;
}

/** Synthesize a timeline from on-chain task data. */
function buildTimeline(task: {
  poster: string;
  createdAt: number;
  rewardStrk: number;
  status: string;
  assignee: string | null;
  proofHash: string | null;
  bids: { bidder: string; timestamp: number; amount: number }[];
}) {
  const events: { action: string; actor: string; timestamp: number; detail?: string }[] = [];

  events.push({
    action: "Task Created",
    actor: task.poster,
    timestamp: task.createdAt,
    detail: `${task.rewardStrk.toLocaleString()} STRK escrowed`,
  });

  for (const bid of task.bids) {
    events.push({
      action: "Bid Placed",
      actor: bid.bidder,
      timestamp: bid.timestamp,
      detail: `${bid.amount.toLocaleString()} STRK`,
    });
  }

  if (task.assignee && task.status !== "open") {
    // Assignee exists — bid was accepted
    const acceptedBid = task.bids.find((b) => b.bidder === task.assignee);
    events.push({
      action: "Bid Accepted",
      actor: task.poster,
      timestamp: acceptedBid ? acceptedBid.timestamp + 1 : task.createdAt + 1,
      detail: `Assigned to ${task.assignee.slice(0, 8)}...`,
    });
  }

  if (task.proofHash) {
    events.push({
      action: "Proof Submitted",
      actor: task.assignee ?? task.poster,
      timestamp: task.createdAt + 2, // Approximate
      detail: `Hash: ${task.proofHash.slice(0, 16)}...`,
    });
  }

  if (task.status === "disputed") {
    events.push({
      action: "Dispute Raised",
      actor: task.poster,
      timestamp: task.createdAt + 3,
    });
  }

  if (task.status === "approved") {
    events.push({
      action: "Approved",
      actor: task.poster,
      timestamp: task.createdAt + 3,
    });
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

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
        const description = tryDecodeDescription(task.descriptionHash);
        const timeline = buildTimeline(task);
        return NextResponse.json({
          ...task,
          description,
          proofSubmittedAt: null,
          timeline,
          source: "onchain",
        });
      }
    } catch {
      // Fall through to 404
    }
  }

  return NextResponse.json({ error: "Task not found" }, { status: 404 });
}
