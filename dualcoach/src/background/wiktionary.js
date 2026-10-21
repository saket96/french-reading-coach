// English Wiktionary REST API (official Wikimedia endpoint; content CC BY-SA 4.0): fetch + a pure parser.
// No chrome.* at module top level so this file is importable from Node (tools/test-wiktionary.mjs).

const ENDPOINT = "https://en.wiktionary.org/api/rest_v1/page/definition/";
export const WIKI_BASE = "https://en.wiktionary.org/wiki/";

const MAX_GROUPS = 3;
const MAX_SENSES = 4;

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", ndash: "–", mdash: "—", lrm: "", rlm: ""
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (m, d) => safeCp(parseInt(d, 10), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeCp(parseInt(h, 16), m))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = ENTITIES[String(name).toLowerCase()];
      return v === undefined ? m : v;
    });
}
function safeCp(cp, fallback) {
  try {
    return String.fromCodePoint(cp);
  } catch (_) {
    return fallback;
  }
}

/** Definition/example HTML → plain text. Drops <style>, ruby readings, nested sub-sense lists and CSS junk. */
export function stripHtml(input) {
  if (input == null) return "";
  let s = String(input)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Nested lists hold sub-senses that the API also returns as their own definitions.
  for (let i = 0; i < 5 && /<(ol|ul)\b/i.test(s); i++) {
    s = s.replace(/<(ol|ul)\b[^>]*>(?:(?!<(?:ol|ul)\b)[\s\S])*?<\/\1>/gi, " ");
  }
  // The API sometimes cuts a definition inside its sub-sense list: drop the unclosed remainder.
  s = s.replace(/<(ol|ul)\b[\s\S]*$/i, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s)
    .replace(/\.mw-parser-output[^{}]*\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
  return s;
}

function isPlaceholder(text) {
  return !text || /this term needs a definition|\brfdef\b|please help out and add a definition/i.test(text);
}

const FORM_OF_RE = /\b(?:form|forms|plural|singular|tense|participle|gerund|inflection|romanization|romanisation|spelling|feminine|masculine|comparative|superlative|diminutive|augmentative|abbreviation|contraction|misspelling|imperative|infinitive|conjugation|mutation|short for|synonym)\b[^.;]*?\bof\s*$/i;

function linkTitles(html) {
  const out = [];
  const re = /<a\b[^>]*\btitle="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = decodeEntities(m[1]);
    if (!/^(?:Appendix|Wiktionary|Template|Category|Help|w|wikipedia):/i.test(t)) out.push(t);
  }
  return out;
}

/**
 * Lemma pointer of a definition ("gerund of comer", "plural of child", "romanization of X"), or "".
 * Primary signal: Wiktionary's form-of template markup (class="form-of-definition-link").
 * Fallback: a short "... of X" definition whose last link points at X.
 */
export function lemmaOf(html, text) {
  const h = String(html || "");
  const at = h.indexOf("form-of-definition-link");
  if (at !== -1) {
    const t = linkTitles(h.slice(at))[0];
    if (t) return t;
  }
  const plain = String(text || stripHtml(h));
  if (plain.length > 80) return "";
  const m = /^(.*?\bof)\s+(.+?)\s*[.:]?$/i.exec(plain);
  if (!m || !FORM_OF_RE.test(m[1])) return "";
  const target = m[2].replace(/\s*\(.*\)$/, "").trim();
  return linkTitles(h).indexOf(target) !== -1 ? target : "";
}

function wikiLang(code) {
  const c = String(code || "").trim().toLowerCase().replace(/_/g, "-");
  const b = c.split("-")[0];
  return { iw: "he", in: "id", ji: "yi" }[b] || b;
}

export function entryUrl(word, languageName) {
  return WIKI_BASE + encodeURIComponent(String(word || "").replace(/ /g, "_")) +
    (languageName ? "#" + encodeURIComponent(String(languageName).replace(/ /g, "_")) : "");
}

/**
 * Pure parser. `json` is the /page/definition response, `lang` the learn language code.
 * Returns null when there is no usable entry for that language (other languages' senses are never used).
 * → {headword, language, link, lemma, formOf, groups:[{pos, senses:[{text, lemma?}], example}]}
 */
export function parseWiktionary(json, lang, word) {
  const code = wikiLang(lang);
  if (!json || typeof json !== "object" || !code || code === "other") return null;
  const list = Array.isArray(json[code]) ? json[code] : [];
  let language = "";
  let lemma = "";
  let formOf = "";
  const groups = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    if (!language && entry.language) language = String(entry.language);
    const senses = [];
    let example = "";
    for (const d of Array.isArray(entry.definitions) ? entry.definitions : []) {
      if (!d) continue;
      // Grammar notes like "[with con ‘with’, …]" are noise in a small card.
      const text = stripHtml(d.definition).replace(/\s*\[(?:with|\+)\b[^\]]*\]/g, "").trim();
      if (isPlaceholder(text)) continue;
      const lem = lemmaOf(d.definition, text);
      if (lem && !lemma && lem.toLowerCase() !== String(word || "").toLowerCase()) {
        lemma = lem;
        formOf = text;
      }
      if (senses.length < MAX_SENSES) senses.push(lem ? { text, lemma: lem } : { text });
      if (!example && Array.isArray(d.examples) && d.examples.length) example = stripHtml(d.examples[0]);
    }
    if (!senses.length) continue;
    groups.push({ pos: stripHtml(entry.partOfSpeech), senses, example });
    if (groups.length >= MAX_GROUPS) break;
  }
  if (!groups.length) return null;
  const headword = String(word || "");
  return { headword, language, link: entryUrl(headword, language), lemma, formOf, groups };
}

/** Groups that are more than a pointer to the lemma. */
export function ownGroups(res) {
  return (res && res.groups ? res.groups : [])
    .map((g) => ({ ...g, senses: g.senses.filter((s) => !s.lemma) }))
    .filter((g) => g.senses.length);
}

/** One GET. → parsed result | null (404 / no entry for `lang`). Throws on network/HTTP errors. */
export async function fetchDefinition(word, lang, { userAgent, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (userAgent) headers["Api-User-Agent"] = userAgent;
    const res = await fetch(ENDPOINT + encodeURIComponent(word), { method: "GET", signal: ctrl.signal, headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("wiktionary http " + res.status);
    return parseWiktionary(await res.json(), lang, word);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lookup for a clicked word: exact text, then lowercase; if the entry is a form of another word,
 * ONE follow-up lookup of the lemma. `fetchFn(word, lang)` defaults to fetchDefinition (lets the
 * service worker add caching and in-flight dedupe).
 * → {headword, language, link, lemma, formOf, entries:[{headword, language, link, groups}]} | null
 */
export async function wiktionaryLookup(word, lang, opts = {}) {
  const fetchFn = opts.fetchFn || ((w, l) => fetchDefinition(w, l, opts));
  const q = String(word || "").trim();
  if (!q) return null;
  let hit = await fetchFn(q, lang);
  if (!hit && q.toLowerCase() !== q) hit = await fetchFn(q.toLowerCase(), lang);
  if (!hit) return null;

  const entries = [];
  let lemmaHit = null;
  if (hit.lemma) {
    try {
      lemmaHit = await fetchFn(hit.lemma, lang);
    } catch (_) {
      lemmaHit = null;
    }
  }
  if (lemmaHit) {
    entries.push({ headword: lemmaHit.headword, language: lemmaHit.language, link: lemmaHit.link, groups: lemmaHit.groups });
    const own = ownGroups(hit);
    if (own.length) entries.push({ headword: hit.headword, language: hit.language, link: hit.link, groups: own });
  } else {
    entries.push({ headword: hit.headword, language: hit.language, link: hit.link, groups: hit.groups });
  }
  return {
    headword: hit.headword,
    language: hit.language,
    link: hit.link,
    lemma: lemmaHit ? lemmaHit.headword : "",
    formOf: lemmaHit ? hit.formOf : "",
    entries
  };
}
