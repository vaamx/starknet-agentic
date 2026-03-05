/**
 * News Search Data Source — Fetches news headlines related to the question.
 *
 * Uses Brave Search API when BRAVE_SEARCH_API_KEY is set.
 * Falls back to category-appropriate simulated headlines.
 */
import type { DataSourceResult } from "./index";
export declare function fetchNewsData(question: string): Promise<DataSourceResult>;
