// Wiktionary parser checks + LIVE lookups against en.wiktionary.org. Run: node tools/test-wiktionary.mjs
import fs from "fs";
import path from "path";
import assert from "assert/strict";
import { parseWiktionary, stripHtml, lemmaOf, wiktionaryLookup } from "../src/background/wiktionary.js";

const here = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(here, "../manifest.json"), "utf8"));
const messages = JSON.parse(fs.readFileSync(path.join(here, "../_locales/en/messages.json"), "utf8"));
const UA = `${messages.brand.message}/${manifest.version} (Chrome extension)`;

let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log("  ok   " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").join("\n       "));
  }
}

// ---------------------------------------------------------------- offline
await test("stripHtml: <style> blocks, .mw-parser-output css, ruby readings, nested lists", () => {
  const html = 'to <a href="/wiki/talk" title="talk">talk</a> <style data-mw-deduplicate="x">.mw-parser-output .object-usage-tag{font-style:italic}</style>' +
    ' .mw-parser-output .deprecated{color:olivedrab} <b>loud</b>ly <ol><li>sub <ol><li>subsub</li></ol></li></ol>';
  assert.equal(stripHtml(html), "to talk loudly");
  assert.equal(stripHtml('to <a title="make">make</a>\n<ol><li><span></span> to <a title="create">create</a>, to build'), "to make");
  assert.equal(stripHtml('ご<ruby>飯<rp>(</rp><rt>はん</rt><rp>)</rp></ruby>を'), "ご飯を");
  assert.equal(stripHtml("fish &amp; chips&#44; &#x2014;"), "fish & chips, —");
});
await test("lemmaOf: form-of markup and short '… of X' definitions", () => {
  const h = '<span class="form-of-definition use-with-mention"><a href="/wiki/Appendix:Glossary#gerund" title="Appendix:Glossary">gerund</a> of <span class="form-of-definition-link"><i><a href="/wiki/comer#Spanish" title="comer">comer</a></i></span></span>';
  assert.equal(lemmaOf(h), "comer");
  assert.equal(lemmaOf('plural of <a href="/wiki/child" title="child">child</a>'), "child");
  assert.equal(lemmaOf('alternative form of <a href="/wiki/colour" title="colour">colour</a>'), "colour");
  assert.equal(lemmaOf('a piece of <a href="/wiki/cake" title="cake">cake</a>'), "");
});
await test("parseWiktionary: only the learn language, placeholders dropped, limits", () => {
  const def = (d, ex) => ({ definition: d, ...(ex ? { examples: [ex] } : {}) });
  const json = {
    fr: [{ partOfSpeech: "Noun", language: "French", definitions: [def("<i>This term needs a definition. Please help out and <b>add a definition</b>, then remove the text {{rfdef}}</i>"), def("house", "une <b>maison</b>")] }],
    es: [{ partOfSpeech: "Noun", language: "Spanish", definitions: [def("fashion house")] }],
    other: [{ partOfSpeech: "Noun", language: "Middle French", definitions: [def("house")] }]
  };
  const fr = parseWiktionary(json, "fr-FR", "maison");
  assert.equal(fr.language, "French");
  assert.deepEqual(fr.groups, [{ pos: "Noun", senses: [{ text: "house" }], example: "une maison" }]);
  assert.equal(fr.link, "https://en.wiktionary.org/wiki/maison#French");
  assert.equal(parseWiktionary(json, "de", "maison"), null);
  assert.equal(parseWiktionary({ en: [{ partOfSpeech: "Adjective", definitions: [def("This term needs a definition. rfdef")] }] }, "en", "x"), null);
  const many = { en: Array.from({ length: 5 }, (_, i) => ({ partOfSpeech: "P" + i, definitions: Array.from({ length: 6 }, (_, j) => def("sense " + j)) })) };
  const r = parseWiktionary(many, "en", "x");
  assert.equal(r.groups.length, 3);
  assert.equal(r.groups[0].senses.length, 4);
});

// ---------------------------------------------------------------- live
const seen = [];
const opts = { userAgent: UA };
async function live(word, lang) {
  const r = await wiktionaryLookup(word, lang, opts);
  seen.push([word, lang, r ? `${r.lemma ? r.headword + " → " + r.lemma + " | " : ""}${r.entries.map((e) => e.headword + ": " + e.groups.map((g) => g.pos + ": " + g.senses.map((s) => s.text).join("; ")).join(" / ")).join(" || ")}` : null]);
  return r;
}
function senses(r) { return r.entries.flatMap((e) => e.groups.flatMap((g) => g.senses.map((s) => s.text))); }

await test("live hablar (es) → Verb: to talk; to speak", async () => {
  const r = await live("hablar", "es");
  assert.ok(r);
  assert.equal(r.language, "Spanish");
  assert.equal(r.entries[0].groups[0].pos, "Verb");
  assert.match(r.entries[0].groups[0].senses[0].text, /^to talk; to speak/);
  assert.ok(!senses(r).some((t) => /mw-parser-output|\{|\}/.test(t)), "no css junk");
  assert.equal(r.link, "https://en.wiktionary.org/wiki/hablar#Spanish");
});
await test("live comiendo (es) → lemma comer, merged", async () => {
  const r = await live("comiendo", "es");
  assert.ok(r);
  assert.equal(r.lemma, "comer");
  assert.match(r.formOf, /gerund of comer/);
  assert.equal(r.entries[0].headword, "comer");
  assert.ok(senses(r).includes("to eat"));
});
await test("live 학교 (ko) → Noun: school", async () => {
  const r = await live("학교", "ko");
  assert.ok(r);
  assert.equal(r.entries[0].groups[0].pos, "Noun");
  assert.match(r.entries[0].groups[0].senses[0].text, /^school/);
});
await test("live 食べる (ja) → Verb: to eat", async () => {
  const r = await live("食べる", "ja");
  assert.ok(r);
  assert.equal(r.entries[0].groups[0].pos, "Verb");
  assert.equal(r.entries[0].groups[0].senses[0].text, "to eat");
});
await test("live maison (fr) → Noun: house", async () => {
  const r = await live("maison", "fr");
  assert.ok(r);
  assert.equal(r.entries[0].groups[0].pos, "Noun");
  assert.equal(r.entries[0].groups[0].senses[0].text, "house");
});
await test("live fumbling (en) → placeholder skipped, lemma fumble + own noun sense", async () => {
  const r = await live("fumbling", "en");
  assert.ok(r);
  assert.ok(!senses(r).some((t) => /needs a definition|rfdef/i.test(t)));
  assert.equal(r.lemma, "fumble");
  assert.equal(r.entries[0].headword, "fumble");
  assert.ok(r.entries.some((e) => e.headword === "fumbling"), "keeps fumbling's own senses");
});
await test("live asdfqwer (en) → null", async () => {
  assert.equal(await live("asdfqwer", "en"), null);
});
await test("live Hablo (es) → lowercase retry, lemma hablar", async () => {
  const r = await live("Hablo", "es");
  assert.ok(r);
  assert.equal(r.lemma, "hablar");
});
await test("live 학교에 (ko, particle attached) → null (card falls back to translation)", async () => {
  assert.equal(await live("학교에", "ko"), null);
});

console.log("\nlive results:");
seen.forEach(([w, l, r]) => console.log(`  ${w} [${l}] → ${r ? r.slice(0, 220) : "null"}`));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
