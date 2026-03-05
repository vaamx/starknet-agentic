import { NextRequest } from "next/server";
/**
 * Spawned Agents endpoint.
 * GET: List all spawned agents with stats.
 * POST: Spawn a new custom agent.
 */
export declare function GET(): Promise<Response>;
export declare function POST(request: NextRequest): Promise<Response>;
