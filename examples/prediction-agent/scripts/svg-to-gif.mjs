#!/usr/bin/env node
/**
 * Renders an animated SVG to an animated GIF via Puppeteer + ffmpeg.
 *
 * Usage:  node scripts/svg-to-gif.mjs [input.svg] [output.gif] [--size 256] [--duration 4.8] [--fps 20]
 */
import { execSync } from "child_process";
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

const inputSvg = args.find((a) => !a.startsWith("-")) || path.join(BRAND, "starknet-agentic-tama-robot.svg");
const outputGif = args.find((a, i) => i > 0 && !a.startsWith("-") && a !== inputSvg) || inputSvg.replace(/\.svg$/, ".png");
const SIZE = parseInt(flag("--size", "256"), 10);
const DURATION = parseFloat(flag("--duration", "4.8"));
const FPS = parseInt(flag("--fps", "20"), 10);
const totalFrames = Math.round(DURATION * FPS);
const tmpDir = path.join("/tmp", `tama-gif-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

console.log(`SVG → GIF`);
console.log(`  input:    ${path.basename(inputSvg)}`);
console.log(`  output:   ${path.basename(outputGif)}`);
console.log(`  size:     ${SIZE}×${SIZE}`);
console.log(`  duration: ${DURATION}s @ ${FPS}fps = ${totalFrames} frames\n`);

const svgSource = fs.readFileSync(inputSvg, "utf-8");

const html = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#060e1a;width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center;overflow:hidden}
svg{width:${SIZE - 32}px;height:${SIZE - 32}px;image-rendering:pixelated}
</style></head><body>${svgSource}</body></html>`;

async function run() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE });
  await page.setContent(html, { waitUntil: "domcontentloaded" });

  await page.evaluate(() => document.querySelector("svg").pauseAnimations());

  console.log("Capturing frames...");
  for (let i = 0; i < totalFrames; i++) {
    const t = (i / totalFrames) * DURATION;
    await page.evaluate((time) => document.querySelector("svg").setCurrentTime(time), t);
    await new Promise((r) => setTimeout(r, 15));

    await page.screenshot({
      path: path.join(tmpDir, `frame_${String(i).padStart(4, "0")}.png`),
      omitBackground: false,
      clip: { x: 0, y: 0, width: SIZE, height: SIZE },
    });

    if ((i + 1) % 10 === 0 || i === totalFrames - 1) process.stdout.write(`  ${i + 1}/${totalFrames}\r`);
  }
  console.log(`\n  ${totalFrames} frames captured.`);
  await browser.close();

  console.log("Encoding APNG...");
  execSync(`ffmpeg -y -framerate ${FPS} -i "${tmpDir}/frame_%04d.png" -plays 0 -f apng "${outputGif}"`, { stdio: "pipe" });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  const stat = fs.statSync(outputGif);
  console.log(`\nDone! ${path.basename(outputGif)} (${(stat.size / 1024).toFixed(1)} KB)`);
}

run().catch((e) => { console.error(e); process.exit(1); });
