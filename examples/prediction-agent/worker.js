/**
 * Cloudflare Worker — BitSage Heartbeat
 *
 * Calls /api/heartbeat every minute via the `crons` trigger defined in wrangler.toml.
 * This removes the browser-tab dependency: the agent loop runs even when no user
 * has the dashboard open.
 *
 * Required Cloudflare Worker secrets:
 *   AGENT_APP_URL      — e.g. https://bitsage.vercel.app
 *   HEARTBEAT_SECRET   — must match HEARTBEAT_SECRET in the Next.js app
 */
export default {
  async scheduled(event, env, ctx) {
    const url = `${env.AGENT_APP_URL}/api/heartbeat`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: env.HEARTBEAT_SECRET }),
      });
      console.log(`[heartbeat] ${url} → HTTP ${res.status}`);
    } catch (err) {
      console.error(`[heartbeat] failed: ${err.message}`);
    }
  },
};
