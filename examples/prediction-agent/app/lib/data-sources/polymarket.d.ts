/**
 * Polymarket Data Source — Fetches prediction market odds from Polymarket.
 *
 * Uses the public Gamma API for market search.
 * Falls back to demo data with realistic Polymarket-style odds.
 */
import type { DataSourceResult } from "./index";
/**
 * Search Polymarket for markets related to the question.
 */
export declare function fetchPolymarketData(question: string): Promise<DataSourceResult>;
