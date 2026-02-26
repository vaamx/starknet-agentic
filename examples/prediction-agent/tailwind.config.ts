import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#0d111c",
        "neo-yellow": "#F5B942",
        "neo-pink": "#E63946",
        "neo-red": "#EF4444",
        "neo-purple": "#7C5CFF",
        "neo-blue": "#4C8DFF",
        "neo-green": "#22C55E",
        "neo-brand": "#00E5CC",
        "neo-orange": "#F97316",
        "neo-cyan": "#14B8A6",
        "neo-dark": "#0B1020",
        "neo-surface": "#131a2a",
      },
      fontFamily: {
        heading: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        body: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      boxShadow: {
        "neo-sm": "0 0 0 1px rgba(255,255,255,0.05), 0 2px 8px rgba(0,0,0,0.3)",
        neo: "0 0 0 1px rgba(255,255,255,0.07), 0 8px 24px rgba(0,0,0,0.4)",
        "neo-lg": "0 0 0 1px rgba(255,255,255,0.09), 0 16px 40px rgba(0,0,0,0.45)",
        "neo-xl": "0 0 0 1px rgba(255,255,255,0.1), 0 24px 56px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
