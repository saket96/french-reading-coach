// Live YouTube E2E: loads the unpacked extension in Playwright's Chromium (muted), sets the language pair,
// opens a TED talk, waits for the overlay, clicks a word, opens the sidebar, presses D/A.
// Screenshots land next to this file (gitignored).
// Needs playwright-core on disk (adjust the createRequire path) and a Playwright Chromium build (adjust CHROME).
//   DC_LEARN=ko DC_NATIVE=en DC_SHOT_PREFIX=ko-en- node tools/e2e/run.mjs [videoUrl]
//   DC_SWITCH=en:ko  → afterwards switch the pair live (learn:native) and check the overlay re-plans.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

// PLAYWRIGHT_CORE_DIR: a node_modules dir containing playwright-core (default: resolve normally).
const require = createRequire(process.env.PLAYWRIGHT_CORE_DIR ? process.env.PLAYWRIGHT_CORE_DIR.replace(/\/?$/, "/") : import.meta.url);
const { chromium } = require("playwright-core");
const here = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(here, "../..");
const VIDEO = process.argv[2] || "https://www.youtube.com/watch?v=arj7oStGLkU";
const LEARN = process.env.DC_LEARN || "auto";
const NATIVE = process.env.DC_NATIVE || "en";
const SWITCH = process.env.DC_SWITCH || "";
// en-US makes the player skip its own caption fetch, which exercises the CC-toggle pot mint.
const LOCALE = process.env.DC_LOCALE || "en-US";
const SHOT_PREFIX = process.env.DC_SHOT_PREFIX || `${LEARN}-${NATIVE}-`;
const messages = JSON.parse(fs.readFileSync(path.join(EXT, "_locales/en/messages.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const BRAND = messages.brand.message;

const CHROME = process.env.CHROME_PATH || os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
// YouTube serves EMPTY caption bodies (even to its own player) when the UA says "HeadlessChrome",
// so the test presents the regular desktop UA of the same Chrome major version.
const major = (execFileSync(CHROME, ["--version"]).toString().match(/(\d+)\./) || [, "150"])[1];
const UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

console.log(`pair: learn=${LEARN} native=${NATIVE} locale=${LOCALE} video=${VIDEO}`);
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "dc-")), {
  headless: false,
  executablePath: CHROME,
  userAgent: UA,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--headless=new", "--mute-audio", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required", `--lang=${LOCALE}`, "--disable-blink-features=AutomationControlled"],
  viewport: { width: 1400, height: 900 },
  locale: LOCALE
});
let exitCode = 1;
let ok = true;
function check(label, cond, extra) {
  console.log((cond ? "PASS " : "FAIL ") + label + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
  if (!cond) ok = false;
}
try {
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
console.log("SW:", sw.url());
await sw.evaluate(async ([learnLang, nativeLang]) => {
  const got = await chrome.storage.sync.get("settings");
  await chrome.storage.sync.set({ settings: { ...(got.settings || {}), learnLang, nativeLang } });
}, [LEARN, NATIVE]);

const page = await ctx.newPage();
await page.addInitScript(() => { try { sessionStorage.setItem("dc.debug", "1"); } catch (_) {} });
page.on("console", (m) => { if (m.text().includes("[" + BRAND + "]")) console.log("[page]", m.text().slice(0, 400)); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
const timedtext = [];
const wikt = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/timedtext")) {
    const q = new URL(u).searchParams;
    const rec = { lang: q.get("lang"), tlang: q.get("tlang"), kind: q.get("kind"), pot: !!q.get("pot"), status: r.status() };
    if (process.env.DC_E2E_VERBOSE) { rec.keys = [...q.keys()].join(","); rec.initiator = r.request().frame() ? "page" : "?"; r.body().then((b) => { rec.len = b.length; }).catch(() => {}); }
    timedtext.push(rec);
  }
});
ctx.on("request", (r) => { if (r.url().includes("wiktionary.org")) wikt.push({ url: decodeURIComponent(r.url()), ua: r.headers()["api-user-agent"] || "" }); });

const shot = (name) => page.locator("#movie_player").screenshot({ path: path.join(here, SHOT_PREFIX + name + ".png") }).then(() => console.log("screenshot", SHOT_PREFIX + name + ".png"));
const fullShot = (name) => page.screenshot({ path: path.join(here, SHOT_PREFIX + name + ".png") }).then(() => console.log("screenshot", SHOT_PREFIX + name + ".png"));
async function dump() {
  return page.evaluate(() => {
    document.dispatchEvent(new Event("dc-debug-dump"));
    const raw = document.documentElement.getAttribute("data-dc-debug");
    return raw ? JSON.parse(raw) : null;
  });
}
async function skipAds() {
  return page.evaluate(() => {
    const p = document.getElementById("movie_player");
    if (!p || !p.classList.contains("ad-showing")) return false;
    const b = document.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button");
    if (b) b.click();
    return true;
  });
}
async function waitLine() {
  let d = null;
  for (let i = 0; i < 20; i++) {
    await skipAds();
    d = await dump();
    if (d.overlay.subsShown && d.overlay.words.length > 1) break;
    await page.waitForTimeout(500);
  }
  return d;
}
async function waitCard() {
  let d = null;
  // DC_GLOSS_WAIT=100 waits long enough for the Translator model download/timeout (90 s).
  const rounds = 2 * Number(process.env.DC_GLOSS_WAIT || 20);
  for (let i = 0; i < rounds; i++) {
    await page.waitForTimeout(500);
    d = await dump();
    const c = d.overlay.card;
    if (c && c.kind && c.kind !== "loading" && !(c.gloss && c.gloss.status === "loading")) break;
  }
  return d;
}

await page.goto(VIDEO, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
for (const label of ["Reject all", "Accept all", "모두 거부", "모두 수락"]) {
  const b = page.getByRole("button", { name: label }).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); console.log("consent:", label); await page.waitForTimeout(2000); break; }
}
await page.waitForSelector("#movie_player video", { timeout: 30000 }).catch(() => {});
await page.evaluate(() => { const v = document.querySelector("#movie_player video"); if (v) { v.muted = true; v.play().catch(() => {}); } });

let d = null;
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  await skipAds();
  d = await dump();
  if (d && d.overlay && d.overlay.cues > 0) break;
  await page.waitForTimeout(1000);
}
console.log("diag:", JSON.stringify(d && d.diag, null, 1));
console.log("timedtext responses:", JSON.stringify(timedtext));
if (!d || !d.overlay || !d.overlay.cues) {
  console.log("overlay never loaded. toast:", d && d.overlay && d.overlay.toast);
  await fullShot("0-failed");
  throw new Error("overlay never loaded");
}
check("cues loaded", d.overlay.cues > 0, { cues: d.overlay.cues, meta: d.overlay.meta });
console.log("toast:", d.overlay.toast);

// Land on the start of a spoken line past the intro and stay paused there (D seeks to the next line start).
async function landOnLine(sec) {
  await page.evaluate((t) => { const v = document.querySelector("#movie_player video"); v.muted = true; v.currentTime = t; v.play().catch(() => {}); }, sec);
  await waitLine();
  await page.evaluate(() => document.querySelector("#movie_player video").pause());
  await page.mouse.move(5, 5); // keep hover-pause out of the screenshots
  await page.keyboard.press("d");
  await page.waitForTimeout(800);
  return dump();
}
d = await landOnLine(95);
console.log("line 1:", JSON.stringify(d.overlay.l1));
console.log("line 2:", JSON.stringify(d.overlay.l2), "chip:", JSON.stringify(d.overlay.chip), "note:", JSON.stringify(d.overlay.note));
check("top line shown", d.overlay.subsShown && !!d.overlay.l1);
check("second line shown", !!d.overlay.l2 || !!d.overlay.note || d.overlay.meta.nativeKind === "", { chip: d.overlay.chip, note: d.overlay.note });
await shot("1-subs");

// Pick a word. Korean/Japanese tokens often carry particles, so for those pick one Wiktionary lists.
const learnLang = d.overlay.meta.learnLang;
await page.evaluate(() => document.querySelector("#movie_player video").pause());
let word = null;
for (let attempt = 0; attempt < 10 && !word; attempt++) {
  d = await dump();
  const cands = [...d.overlay.words].filter((w) => /\p{L}/u.test(w.text)).sort((a, b) => b.text.length - a.text.length);
  if (learnLang === "en" || learnLang === "es" || learnLang === "fr") { word = cands[0]; break; }
  for (const w of cands) {
    const r = await fetch("https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(w.text), { headers: { "Api-User-Agent": `${BRAND}-e2e/${manifest.version}` } });
    if (r.ok && (await r.json())[learnLang]) { word = w; break; }
  }
  if (!word) { await page.keyboard.press("d"); await page.waitForTimeout(700); await page.evaluate(() => document.querySelector("#movie_player video").pause()); }
}
check("found a word with a Wiktionary entry", !!word, word && word.text);
if (word) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  d = await dump();
  word = d.overlay.words.find((w) => w.text === word.text) || word;
  console.log("clicking word:", word.text);
  wikt.length = 0;
  await page.mouse.move(word.x, word.y, { steps: 5 });
  await page.waitForTimeout(300);
  await page.mouse.click(word.x, word.y);
  d = await waitCard();
  const card = d.overlay.card || {};
  const paused = await page.evaluate(() => document.querySelector("#movie_player video").paused);
  console.log("card:", JSON.stringify(card, null, 1));
  console.log("wiktionary requests:", JSON.stringify(wikt));
  check("word card open", d.overlay.cardOpen);
  check("dictionary card from Wiktionary", card.kind === "dict", card.kind);
  check("attribution link to en.wiktionary.org/wiki/…#Language", (card.links || []).some((h) => /^https:\/\/en\.wiktionary\.org\/wiki\/.+#.+/.test(h)) && /Wiktionary · CC BY-SA 4\.0/.test(card.text || ""));
  check("video paused on click", paused);
  await shot("2-word-card");
}

const translator = await page.evaluate(async ([src, tgt]) => {
  if (!("Translator" in self)) return "Translator API not present";
  try { return await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt }); } catch (e) { return "error: " + e.message; }
}, [learnLang || "en", NATIVE]);
console.log(`Translator availability ${learnLang}→${NATIVE}:`, translator);

// Close card, open sidebar.
await page.keyboard.press("Escape");
await page.mouse.move(5, 5);
await page.waitForTimeout(400);
await page.keyboard.press("t");
await page.waitForTimeout(1200);
d = await dump();
check("sidebar open", d.overlay.side);
await shot("3-sidebar");
await page.keyboard.press("t");

// D → next line, A → previous line.
await page.evaluate(() => document.querySelector("#movie_player video").pause());
await page.waitForTimeout(300);
d = await dump();
const expected = d.overlay.next && d.overlay.next.start;
await page.keyboard.press("d");
await page.waitForTimeout(700);
const after = await page.evaluate(() => document.querySelector("#movie_player video").currentTime);
check("D jumps to next cue start", expected != null && Math.abs(after - expected) < 0.2, { before: d.overlay.t, expected, after });
await page.keyboard.press("a");
await page.waitForTimeout(500);
const afterA = await page.evaluate(() => document.querySelector("#movie_player video").currentTime);
check("A goes back one line", afterA < after, { afterA });
check("native caption CSS injected", await page.evaluate(() => !!document.getElementById("dc-hide-yt-captions")));

if (process.env.DC_E2E_VERBOSE) {
  // Raw cues of a few tracks around the test position, to judge alignment by eye.
  const raw = await page.evaluate(async (langs) => {
    const pr = document.getElementById("movie_player").getPlayerResponse();
    const pots = JSON.parse(sessionStorage.getItem("dc.pot.v1") || "{}");
    const pot = pots[pr.videoDetails.videoId];
    const out = {};
    for (const l of langs) {
      const t = pr.captions.playerCaptionsTracklistRenderer.captionTracks.find((x) => x.languageCode === l && x.kind !== "asr");
      if (!t) continue;
      const u = new URL(t.baseUrl, location.href);
      u.searchParams.set("fmt", "json3");
      if (pot) { u.searchParams.set("pot", pot); u.searchParams.set("c", "WEB"); }
      const j = await (await fetch(u)).json();
      out[l] = j.events.filter((e) => e.segs && e.tStartMs > 88000 && e.tStartMs < 106000)
        .map((e) => (e.tStartMs / 1000).toFixed(2) + "-" + ((e.tStartMs + (e.dDurationMs || 0)) / 1000).toFixed(2) + " " + e.segs.map((x) => x.utf8).join(""));
    }
    return out;
  }, ["en", "es", "ko"]).catch((e) => "error " + e.message);
  console.log("raw cues 88-106s:", JSON.stringify(raw, null, 1));
}

if (SWITCH) {
  const [l, n] = SWITCH.split(":");
  const before = (await dump()).overlay.meta;
  await sw.evaluate(async ([learnLang, nativeLang]) => {
    const got = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({ settings: { ...(got.settings || {}), learnLang, nativeLang } });
  }, [l, n]);
  let m = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    d = await dump();
    m = d.overlay.meta;
    if (m && (m.learnLang !== before.learnLang || m.nativeLang !== before.nativeLang)) break;
  }
  d = await landOnLine(95);
  console.log("after live switch:", JSON.stringify({ meta: d.overlay.meta, l1: d.overlay.l1, l2: d.overlay.l2, chip: d.overlay.chip, toast: d.overlay.toast }));
  check(`live switch to ${SWITCH} re-planned without reload`, m && m.learnLang === l && (l === n || m.nativeLang === n), m);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await shot("4-after-switch");
}

const opt = await ctx.newPage();
const base = sw.url().replace(/src\/background.*/, "");
await opt.goto(base + "src/options/options.html");
await opt.waitForTimeout(800);
await opt.screenshot({ path: path.join(here, SHOT_PREFIX + "5-options.png"), fullPage: true });
console.log("screenshot", SHOT_PREFIX + "5-options.png");
const pop = await ctx.newPage();
await pop.setViewportSize({ width: 260, height: 420 });
await pop.goto(base + "src/action/popup.html");
await pop.waitForTimeout(600);
await pop.screenshot({ path: path.join(here, SHOT_PREFIX + "6-popup.png"), fullPage: true });
console.log("screenshot", SHOT_PREFIX + "6-popup.png");

console.log(ok ? "\nE2E: ALL PASS" : "\nE2E: SOME CHECKS FAILED");
exitCode = ok ? 0 : 1;
} catch (e) {
  console.log("E2E aborted:", e && e.message);
} finally {
  await ctx.close().catch(() => {});
}
process.exit(exitCode);
