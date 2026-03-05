import { NextRequest } from "next/server";
/**
 * Data Sources endpoint.
 * GET ?question=...&sources=polymarket,coingecko
 * Returns aggregated data from all requested sources.
 */
export declare function GET(request: NextRequest): Promise<Response>;
