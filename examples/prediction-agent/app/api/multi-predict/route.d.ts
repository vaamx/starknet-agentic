import { NextRequest } from "next/server";
/**
 * Multi-agent forecast endpoint.
 * Runs all agent personas on a market and streams their reasoning.
 * Each agent produces an independent probability estimate.
 * The final output includes a reputation-weighted consensus.
 */
export declare function POST(request: NextRequest): Promise<Response>;
