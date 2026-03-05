/**
 * Structured JSON logger for the MCP server.
 *
 * All output goes to **stderr** because stdout is reserved for the MCP
 * stdio transport. Each line is a single JSON object with a consistent
 * schema so operators can parse, filter, and alert on log events with
 * standard tooling (jq, Datadog, CloudWatch, etc.).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEntry {
    level: LogLevel;
    event: string;
    tool?: string;
    details?: Record<string, unknown>;
}
export declare function setLogLevel(level: LogLevel): void;
export declare function log(entry: LogEntry): void;
