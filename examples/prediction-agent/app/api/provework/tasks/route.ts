import { NextRequest, NextResponse } from "next/server";
import { shortString } from "starknet";
import { listTasks } from "@/lib/economy-reader";

export const runtime = "nodejs";

/** Try to decode a felt252 hex description hash as a readable short string. */
function tryDecodeDescription(hash: string): string | null {
  try {
    const decoded = shortString.decodeShortString(hash);
    if (decoded && /^[\x20-\x7E]+$/.test(decoded) && decoded.length > 1) {
      return decoded;
    }
  } catch {
    // not a valid short string
  }
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    const result = await listTasks(offset, limit, status);
    // Decode descriptions from on-chain felt252 hashes
    const tasks = result.tasks.map((t) => ({
      ...t,
      description: tryDecodeDescription(t.descriptionHash),
    }));

    return NextResponse.json({
      tasks,
      total: result.total,
      offset,
      limit,
      source: "onchain",
    });
  } catch (err) {
    return NextResponse.json(
      { tasks: [], total: 0, offset, limit, source: "error", error: String(err) },
      { status: 200 }
    );
  }
}
