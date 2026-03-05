import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  webpack: (config) => {
    if (config.resolve?.extensions) {
      const preferred = [".ts", ".tsx"];
      const remaining = config.resolve.extensions.filter(
        (extension: string) => !preferred.includes(extension)
      );
      config.resolve.extensions = [...preferred, ...remaining];
    }
    return config;
  },
};

export default nextConfig;
