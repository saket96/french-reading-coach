// Service worker: message router. Holds no durable state beyond a settings memo.

import { getSettings, getApiKey, hasProviderAccess, languageName, baseLang, DEFAULTS, modelKeyFor } from "./settings.js";
import { fetchDefinition, wiktionaryLookup } from "./wiktionary.js";
import { llmExplain } from "./llm.js";
import { cacheGet, cacheSet, cacheClear, shortHash, DAY, TTL_DICT, TTL_LLM } from "./cache.js";
import {
  searchSubtitles,
  downloadSubtitle,
  testOpenSubtitles as probeOpenSubtitles,
  ensureOsToken,
  setStoredOsCredentials,
  getStoredOsAuth,
  loginOpenSubtitles
} from "./opensubtitles.js";

const VOCAB_KEY = "vocab";
const TTL_MISS = 3 * DAY;
const USER_AGENT = `${chrome.i18n.getMessage("brand") || "DualCoach"}/${chrome.runtime.getManifest().version} (Chrome extension)`;

const TTS_LANG = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR", ja: "ja-JP", ko: "ko-KR",
  zh: "zh-CN", ru: "ru-RU", ar: "ar-SA", hi: "hi-IN", tr: "tr-TR", nl: "nl-NL", pl: "pl-PL", sv: "sv-SE",
  vi: "vi-VN", th: "th-TH", id: "id-ID"
};

let settingsMemo = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) settingsMemo = null;
});
async function settings() {
  if (!settingsMemo) settingsMemo = await getSettings();
  return settingsMemo;
}

async function llmConfig() {
  const s = await settings();
  const provider = s.llmProvider;
  if (!provider || provider === "none") return null;
  const apiKey = await getApiKey(provider);
  if (!apiKey || !(await hasProviderAccess(provider))) return null;
  const mk = modelKeyFor(provider);
  return { provider, apiKey, model: s[mk] || DEFAULTS[mk] };
}

// ---- vocab ----
async function vocabRead() {
  const got = await chrome.storage.local.get(VOCAB_KEY);
  return Array.isArray(got && got[VOCAB_KEY]) ? got[VOCAB_KEY] : [];
}
async function vocabWrite(list) {
  await chrome.storage.local.set({ [VOCAB_KEY]: list });
}
function vocabId(text, lang) {
  const t = String(text || "").trim().toLowerCase();
  return t ? (baseLang(lang) || "und") + "|" + t : "";
}
async function isSaved(text, lang) {
  const id = vocabId(text, lang);
  if (!id) return false;
  return (await vocabRead()).some((v) => v.id === id);
}

// ---- dictionary: one request per word, cached, identical in-flight requests shared ----
const inflight = new Map();
function cachedDefinition(word, lang) {
  const key = `wk1|${baseLang(lang)}|${word}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const hit = await cacheGet(key);
    if (hit) return hit.miss ? null : hit;
    const res = await fetchDefinition(word, lang, { userAgent: USER_AGENT });
    await cacheSet(key, res || { miss: true }, res ? TTL_DICT : TTL_MISS);
    return res;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---- lookup ----
async function doLookup({ text, context, isWord, lang, native }) {
  const query = String(text || "").trim();
  if (!query) return { kind: "error", error: "Nothing selected" };
  const learn = baseLang(lang);
  const nat = baseLang(native) || "en";

  // 1) Wiktionary for single words (spaceless scripts: any short selection without spaces).
  if (learn && (isWord || (!/\s/.test(query) && query.length <= 20))) {
    let dict = null;
    let failed = false;
    try {
      dict = await wiktionaryLookup(query, learn, { fetchFn: cachedDefinition });
    } catch (_) {
      failed = true;
    }
    if (dict) return { kind: "dict", lang: learn, ...dict };
    if (failed && !(await llmConfig())) return { kind: "needTranslator", error: "Couldn't reach Wiktionary." };
  }

  // 2) LLM, when the user added a key.
  const cfg = await llmConfig();
  if (!cfg) return { kind: "needTranslator" };
  const key = `llm1|${learn}|${nat}|${query.toLowerCase()}|${shortHash(context || "")}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  try {
    const out = await llmExplain({
      text: query,
      context,
      learnName: languageName(learn),
      nativeName: languageName(nat),
      ...cfg
    });
    const payload = { kind: "llm", text: query, lang: learn, ...out };
    await cacheSet(key, payload, TTL_LLM);
    return payload;
  } catch (e) {
    return { kind: "needTranslator", error: e && e.message ? e.message : "Request failed" };
  }
}

async function doContext({ text, context, lang, native }) {
  const query = String(text || "").trim();
  if (!query) return { error: "Nothing selected" };
  const learn = baseLang(lang);
  const nat = baseLang(native) || "en";
  const key = `ctx1|${learn}|${nat}|${query.toLowerCase()}|${shortHash(context || "")}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const cfg = await llmConfig();
  if (!cfg) return { error: "Add an AI key in Settings to see this" };
  try {
    const out = await llmExplain({
      text: query,
      context,
      learnName: languageName(learn),
      nativeName: languageName(nat),
      ...cfg
    });
    const payload = { meaning: out.meaning, explanation: out.explanation, literal: out.literal, model: out.model };
    await cacheSet(key, payload, TTL_LLM);
    return payload;
  } catch (e) {
    return { error: e && e.message ? e.message : "Request failed" };
  }
}

// ---- router ----
const handlers = {
  async lookup(msg) {
    const res = await doLookup(msg);
    if (res.kind === "dict" || res.kind === "llm") res.saved = await isSaved(msg.text, msg.lang);
    return res;
  },

  context: (msg) => doContext(msg),

  async isSaved(msg) {
    return { saved: await isSaved(msg.text, msg.lang) };
  },

  async speak(msg) {
    const text = String(msg.text || "").trim();
    if (!text) return { ok: false };
    const b = baseLang(msg.lang);
    const lang = /-/.test(String(msg.lang || "")) ? String(msg.lang) : TTS_LANG[b] || b || "en-US";
    try {
      chrome.tts.stop();
      chrome.tts.speak(text, { lang, rate: 0.95 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
  },

  async vocabToggle(msg) {
    const item = msg.item || {};
    const id = vocabId(item.text, item.lang);
    if (!id) return { saved: false };
    const list = await vocabRead();
    const at = list.findIndex((v) => v.id === id);
    if (at !== -1) {
      list.splice(at, 1);
      await vocabWrite(list);
      return { saved: false };
    }
    list.unshift({
      id,
      text: String(item.text || ""),
      lemma: String(item.lemma || ""),
      lang: baseLang(item.lang),
      meaning: String(item.meaning || ""),
      sentence: String(item.sentence || ""),
      sentenceNative: String(item.sentenceNative || ""),
      site: String(item.site || ""),
      title: String(item.title || ""),
      url: String(item.url || ""),
      time: Math.max(0, Math.floor(Number(item.time) || 0)),
      savedAt: Date.now()
    });
    await vocabWrite(list);
    return { saved: true };
  },

  async vocabList() {
    return { items: await vocabRead() };
  },

  async vocabRemove(msg) {
    if (msg.all) {
      await vocabWrite([]);
      return { items: [] };
    }
    const list = (await vocabRead()).filter((v) => v.id !== msg.id);
    await vocabWrite(list);
    return { items: list };
  },

  async openOptions() {
    try {
      await chrome.runtime.openOptionsPage();
    } catch (_) {
      /* ignore */
    }
    return { ok: true };
  },

  async getState() {
    const s = await settings();
    return { settings: s, defaults: DEFAULTS, provider: s.llmProvider, hasKey: !!(await llmConfig()) };
  },

  async clearCache() {
    return { cleared: await cacheClear() };
  },

  async osStatus() {
    const apiKey = await getApiKey("opensubtitles");
    const allowed = await hasProviderAccess("opensubtitles");
    return { hasKey: !!apiKey, allowed };
  },

  /** Fetch remote text via the service worker (bypasses page CSP connect-src). */
  async fetchText(msg) {
    const url = String((msg && msg.url) || "").trim();
    if (!url || /^(data|blob|javascript):/i.test(url)) {
      return { error: "Invalid URL", status: 0, text: "" };
    }
    try {
      const res = await fetch(url, {
        credentials: msg.credentials === "include" ? "include" : "omit",
        redirect: "follow"
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, text };
    } catch (e) {
      return { error: e && e.message ? e.message : "Fetch failed", status: 0, text: "" };
    }
  },

  async osSearch(msg) {
    const apiKey = await getApiKey("opensubtitles");
    if (!apiKey) return { error: "Add an OpenSubtitles API key in Settings" };
    if (!(await hasProviderAccess("opensubtitles"))) {
      return { error: "Permission to contact api.opensubtitles.com was not granted" };
    }
    const s = await settings();
    const learn = baseLang(msg.learnLang || s.learnLang) || "fr";
    const native = baseLang(msg.nativeLang || s.nativeLang) || "en";
    const languages = [...new Set([learn, native, ...(msg.languages || [])].map(baseLang).filter(Boolean))];
    try {
      const out = await searchSubtitles({
        apiKey,
        query: msg.query,
        languages,
        season: msg.season,
        episode: msg.episode
      });
      return { results: out.results, total: out.total, learn, native };
    } catch (e) {
      return { error: e && e.message ? e.message : "OpenSubtitles search failed" };
    }
  },

  async osDownload(msg) {
    const apiKey = await getApiKey("opensubtitles");
    if (!apiKey) return { error: "Add an OpenSubtitles API key in Settings" };
    if (!(await hasProviderAccess("opensubtitles"))) {
      return { error: "Permission to contact api.opensubtitles.com was not granted" };
    }
    try {
      const file = await downloadSubtitle({ apiKey, fileId: msg.fileId });
      return { text: file.text, fileName: file.fileName, remaining: file.remaining };
    } catch (e) {
      return { error: e && e.message ? e.message : "OpenSubtitles download failed" };
    }
  },

  /** Search + download best learn (+ optional native) tracks in one step. */
  async osLoadBest(msg) {
    const apiKey = await getApiKey("opensubtitles");
    if (!apiKey) return { error: "Add an OpenSubtitles API key in Settings" };
    if (!(await hasProviderAccess("opensubtitles"))) {
      return { error: "Permission to contact api.opensubtitles.com was not granted" };
    }
    const s = await settings();
    const learn = baseLang(msg.learnLang || s.learnLang) || "fr";
    const native = baseLang(msg.nativeLang || s.nativeLang) || "en";
    try {
      const { results } = await searchSubtitles({
        apiKey,
        query: msg.query,
        languages: learn === native ? [learn] : [learn, native],
        season: msg.season,
        episode: msg.episode
      });
      const pick = (lang) =>
        results.find((r) => r.language === lang) || results.find((r) => baseLang(r.language) === lang);
      const learnHit = pick(learn);
      if (!learnHit) return { error: "No " + (languageName(learn) || learn) + " subtitles found" };
      const learnFile = await downloadSubtitle({ apiKey, fileId: learnHit.fileId });
      let nativeFile = null;
      let nativeHit = null;
      if (native && native !== learn) {
        nativeHit = pick(native);
        if (nativeHit) nativeFile = await downloadSubtitle({ apiKey, fileId: nativeHit.fileId });
      }
      return {
        learnLang: learn,
        nativeLang: native,
        learn: { text: learnFile.text, fileName: learnFile.fileName, meta: learnHit },
        native: nativeFile
          ? { text: nativeFile.text, fileName: nativeFile.fileName, meta: nativeHit }
          : null,
        remaining: nativeFile && nativeFile.remaining != null ? nativeFile.remaining : learnFile.remaining
      };
    } catch (e) {
      return { error: e && e.message ? e.message : "OpenSubtitles load failed" };
    }
  },

  // Named osTest (not testOpenSubtitles) so it cannot shadow the imported probe helper.
  async osTest(msg) {
    const apiKey = msg.apiKey || (await getApiKey("opensubtitles"));
    if (!apiKey) return { ok: false, error: "Enter an API key first" };
    if (!(await hasProviderAccess("opensubtitles"))) {
      return { ok: false, error: "Permission to contact api.opensubtitles.com was not granted" };
    }
    try {
      return await probeOpenSubtitles(apiKey);
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : "Connection failed" };
    }
  },

  // Options page "Test": a real, tiny request with the key being edited.
  async testLlm(msg) {
    const s = await settings();
    const provider = msg.provider || s.llmProvider;
    const apiKey = msg.apiKey || (await getApiKey(provider));
    if (!apiKey) return { ok: false, error: "Enter an API key first" };
    if (!(await hasProviderAccess(provider))) return { ok: false, error: "Permission to contact the provider was not granted" };
    try {
      const out = await llmExplain({
        text: "double down on",
        context: "We decided to double down on our core product.",
        learnName: "English",
        nativeName: languageName(s.nativeLang),
        provider,
        apiKey,
        model: msg.model || s[modelKeyFor(provider)] || DEFAULTS[modelKeyFor(provider)]
      });
      return { ok: true, meaning: out.meaning, explanation: out.explanation, model: out.model };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : "Connection failed" };
    }
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type;
  // Back-compat alias from older options builds
  const fn = type ? handlers[type] || (type === "testOpenSubtitles" ? handlers.osTest : null) : null;
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg, sender))
    .then((res) => {
      try {
        sendResponse(res);
      } catch (_) {
        /* port already closed */
      }
    })
    .catch((e) => {
      try {
        sendResponse({ ok: false, error: e && e.message ? e.message : "Unknown error" });
      } catch (_) {
        /* port already closed */
      }
    });
  return true;
});
