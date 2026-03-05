import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return [
      {
        source: "/.well-known/agent-card.json",
        destination: "/api/well-known-agent-card",
      },
      {
        source: "/.well-known/agent.json",
        destination: "/api/well-known-agent",
      },
    ];
  },
};

export default nextConfig;
