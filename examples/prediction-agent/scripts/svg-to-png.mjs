#!/usr/bin/env node
/**
 * Renders an SVG to a static PNG via Puppeteer.
 * Usage: node scripts/svg-to-png.mjs [input.svg] [output.png] [--width 1500] [--height 500]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAND = path.resolve(__dirname, "../public/brand");

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const positional = args.filter((a) => !a.startsWith("-"));
const inputSvg = positional[0] || path.join(BRAND, "twitter-banner.svg");
const outputPng = positional[1] || inputSvg.replace(/\.svg$/, ".png");
const WIDTH = parseInt(flag("--width", "1500"), 10);
const HEIGHT = parseInt(flag("--height", "500"), 10);

const svgSource = fs.readFileSync(inputSvg, "utf-8");

const html = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#060e1a}
svg{width:${WIDTH}px;height:${HEIGHT}px;display:block;image-rendering:pixelated}
</style></head><body>${svgSource}</body></html>`;

async function run() {
  console.log(`SVG → PNG`);
  console.log(`  input:  ${path.basename(inputSvg)}`);
  console.log(`  output: ${path.basename(outputPng)}`);
  console.log(`  size:   ${WIDTH}×${HEIGHT}\n`);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle0" });

  await page.screenshot({
    path: outputPng,
    omitBackground: false,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });

  await browser.close();
  const stat = fs.statSync(outputPng);
  console.log(`Done! ${path.basename(outputPng)} (${(stat.size / 1024).toFixed(1)} KB)`);
}

run().catch((e) => { console.error(e); process.exit(1); });
