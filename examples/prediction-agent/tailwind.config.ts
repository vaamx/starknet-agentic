import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#050810",
        "neo-yellow": "#F5B942",
        "neo-pink": "#E63946",
        "neo-purple": "#7C5CFF",
        "neo-blue": "#4C8DFF",
        "neo-green": "#00E5CC",
        "neo-orange": "#F97316",
        "neo-cyan": "#14B8A6",
        "neo-dark": "#0B1020",
      },
      fontFamily: {
        heading: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        body: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      boxShadow: {
        "neo-sm": "0 0 0 1px rgba(255,255,255,0.06), 0 6px 16px rgba(0,0,0,0.35)",
        neo: "0 0 0 1px rgba(255,255,255,0.08), 0 16px 32px rgba(0,0,0,0.45)",
        "neo-lg": "0 0 0 1px rgba(255,255,255,0.1), 0 24px 48px rgba(0,0,0,0.55)",
        "neo-xl": "0 0 0 1px rgba(255,255,255,0.12), 0 32px 64px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
export default config;
