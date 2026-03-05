/**
 * server.ts — re-exports the shared MCP Server instance.
 *
 * Importing from here (instead of directly from index.ts) is the
 * preferred pattern for new entry points (http-server.ts, tests, etc.).
 * Node.js module caching ensures only one server instance exists per process.
 */
export { server } from "./index.js";
