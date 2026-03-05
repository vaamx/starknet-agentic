import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /* ── Backgrounds ── */
        cream: "#12141a",         /* main bg — warm dark charcoal, not blue */
        "neo-dark": "#0d0f14",    /* deeper bg for overlays */
        "neo-surface": "#181b23", /* raised surface */

        /* ── Cards ── */
        "hc-card": "#1a1d27",
        "hc-card-hover": "#1f2230",
        "hc-border": "rgba(255,255,255,0.07)",
        "hc-muted": "#6b7280",

        /* ── Brand & accents ── */
        "neo-brand": "#00d4b8",   /* slightly warmer teal */
        "neo-cyan": "#14b8a6",
        "neo-blue": "#4c8dff",
        "neo-purple": "#7c5cff",
        "neo-pink": "#e63946",
        "neo-red": "#ef4444",
        "neo-orange": "#f97316",
        "neo-yellow": "#f5b942",
        "neo-green": "#22c55e",

        /* ── Category signature colors ── */
        "cat-sports": "#10b981",
        "cat-crypto": "#f59e0b",
        "cat-politics": "#6366f1",
        "cat-tech": "#8b5cf6",
        "cat-world": "#ec4899",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      boxShadow: {
        "neo-sm": "0 0 0 1px rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.3)",
        neo: "0 0 0 1px rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.4)",
        "neo-lg": "0 0 0 1px rgba(255,255,255,0.08), 0 12px 32px rgba(0,0,0,0.5)",
        "neo-xl": "0 0 0 1px rgba(255,255,255,0.1), 0 24px 56px rgba(0,0,0,0.5)",
        "card-glow":
          "0 0 0 1px rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.2), 0 0 24px rgba(0,0,0,0.15)",
      },
      gridTemplateColumns: {
        "market-grid": "repeat(auto-fill, minmax(320px, 1fr))",
      },
    },
  },
  plugins: [],
};
export default config;
