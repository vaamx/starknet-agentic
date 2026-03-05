#!/usr/bin/env node

const [major] = process.versions.node.split(".").map((part) => Number(part));

if (!Number.isFinite(major) || major < 22) {
  console.error(
    [
      "Prediction-agent requires Node.js >= 22.0.0.",
      `Detected: ${process.version}`,
      "This app uses runtime APIs (for example node:sqlite) that are unavailable in Node 20.",
      "Use `nvm use 22` (or equivalent) and retry.",
    ].join("\n")
  );
  process.exit(1);
}
