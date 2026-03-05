import { NextRequest } from "next/server";
/**
 * Agent Loop control endpoint.
 * POST: Start/stop the autonomous loop.
 * GET: Current loop status + recent action log.
 */
export declare function POST(request: NextRequest): Promise<Response>;
export declare function GET(): Promise<Response>;
