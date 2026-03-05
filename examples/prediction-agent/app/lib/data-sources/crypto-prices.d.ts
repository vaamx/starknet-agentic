/**
 * Crypto Prices Data Source — Fetches price data from CoinGecko.
 *
 * Uses the free CoinGecko API for current prices and trends.
 * Falls back to hardcoded recent prices when API is unavailable.
 */
import type { DataSourceResult } from "./index";
/**
 * Detect crypto mentions in question and fetch their prices.
 */
export declare function fetchCryptoPrices(question: string): Promise<DataSourceResult>;
