#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, ".next", "types"),
  path.join(root, ".next", "dev", "types"),
  path.join(root, "tsconfig.tsbuildinfo"),
];

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
}
