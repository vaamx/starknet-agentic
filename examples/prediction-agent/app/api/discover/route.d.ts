import { NextRequest } from "next/server";
/**
 * Market Discovery endpoint.
 * GET: Returns suggested markets from the discovery engine.
 * Optional query params: ?category=crypto&limit=5
 */
export declare function GET(request: NextRequest): Promise<Response>;
