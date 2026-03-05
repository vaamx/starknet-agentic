/**
 * Structured JSON logger for the MCP server.
 *
 * All output goes to **stderr** because stdout is reserved for the MCP
 * stdio transport. Each line is a single JSON object with a consistent
 * schema so operators can parse, filter, and alert on log events with
 * standard tooling (jq, Datadog, CloudWatch, etc.).
 */
const LEVEL_RANK = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
let minLevel = "info";
export function setLogLevel(level) {
    minLevel = level;
}
function safeStringify(value) {
    // Defensive: JSON.stringify throws on BigInt and can blow up on circular refs.
    // Logging must never take down the MCP process.
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, v) => {
        if (typeof v === "bigint")
            return v.toString(10);
        if (v instanceof Error) {
            return { name: v.name, message: v.message };
        }
        if (typeof v === "object" && v !== null) {
            if (seen.has(v))
                return "[Circular]";
            seen.add(v);
        }
        return v;
    });
}
export function log(entry) {
    if (LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) {
        return;
    }
    const line = {
        ts: new Date().toISOString(),
        level: entry.level,
        event: entry.event,
        ...(entry.tool ? { tool: entry.tool } : {}),
        ...(entry.details && Object.keys(entry.details).length > 0
            ? { details: entry.details }
            : {}),
    };
    try {
        process.stderr.write(`${safeStringify(line)}\n`);
    }
    catch {
        // Absolute last resort: keep running even if stderr is broken.
    }
}
