/**
 * GET /api/soul — Returns the agent's evolving self-description as Markdown.
 *
 * Readable by any external agent (OpenClaw, Daydreams, etc.) for discovery.
 * Content-Type: text/markdown; charset=utf-8
 */

import { getSoul } from "@/lib/soul";

export async function GET() {
  return new Response(getSoul(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
