// Renders store/src/*.html to exact-size, alpha-free PNGs in store/. Run: node store/render.mjs [name ...]
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync } from "child_process";

// PLAYWRIGHT_CORE_DIR: a node_modules dir containing playwright-core (default: resolve normally).
const require = createRequire(process.env.PLAYWRIGHT_CORE_DIR ? process.env.PLAYWRIGHT_CORE_DIR.replace(/\/?$/, "/") : import.meta.url);
const { chromium } = require("playwright-core");
const CHROME = process.env.CHROME_PATH || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(here, "src");
const HEAD = fs.readFileSync(path.join(src, "_head.html"), "utf8");
// The toolbar popup's own stylesheet, taken verbatim from src/action/popup.html.
const OPTIONS_CSS = fs.readFileSync(path.join(here, "../src/options/options.css"), "utf8");
const POPUP_CSS = fs.readFileSync(path.join(here, "../src/action/popup.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];

const ASSETS = [
  ["screenshot-1", 1280, 800], ["screenshot-2", 1280, 800], ["screenshot-3", 1280, 800],
  ["screenshot-4", 1280, 800], ["screenshot-5", 1280, 800],
  ["promo-small-440x280", 440, 280], ["promo-marquee-1400x560", 1400, 560]
];
const only = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--headless=new", "--mute-audio"] });
try {
  for (const [name, w, h] of ASSETS) {
    if (only.length && !only.includes(name)) continue;
    const file = path.join(src, name + ".html");
    if (!fs.existsSync(file)) { console.log("skip " + name); continue; }
    // Inline the shared <head> so every page uses the same fonts, CSS and scripts.
    const built = path.join(src, "_" + name + ".built.html");
    fs.writeFileSync(built, fs.readFileSync(file, "utf8").replace("<!--HEAD-->", HEAD).replace("/*POPUP_CSS*/", () => POPUP_CSS).replace("/*OPTIONS_CSS*/", () => OPTIONS_CSS));
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("  pageerror " + name + ": " + e.message));
    await page.goto("file://" + built, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const tmp = path.join(here, "_" + name + ".tmp.png");
    await page.screenshot({ path: tmp, clip: { x: 0, y: 0, width: w, height: h } });
    await ctx.close();
    fs.unlinkSync(built);
    // Flatten onto white and drop the alpha channel (CWS wants no transparency): 24-bit PNG.
    const out = path.join(here, name + ".png");
    execFileSync("magick", [tmp, "-background", "white", "-alpha", "remove", "-alpha", "off", "-define", "png:color-type=2", out]);
    fs.unlinkSync(tmp);
    console.log(execFileSync("magick", ["identify", out]).toString().trim());
  }
} finally {
  await browser.close();
}

// Store icon: the extension's own 128px icon (already 96x96 art + 16px transparent padding, per CWS guideline).
if (!only.length || only.includes("icon")) {
  fs.copyFileSync(path.join(here, "../icons/icon128.png"), path.join(here, "store-icon-128.png"));
  console.log(execFileSync("magick", ["identify", path.join(here, "store-icon-128.png")]).toString().trim());
}

