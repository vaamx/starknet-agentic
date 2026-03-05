/**
 * Social Trends Data Source — Detects social sentiment signals.
 *
 * Provides trending scores and related topic detection.
 * Uses keyword analysis and category-based sentiment estimation.
 */
import type { DataSourceResult } from "./index";
export declare function fetchSocialTrends(question: string): Promise<DataSourceResult>;
