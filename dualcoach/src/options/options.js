// Options page. Auto-saves on every change.

import {
  DEFAULTS,
  PROVIDER_ORIGINS,
  getSettings,
  setSettings,
  getApiKey,
  setApiKey,
  languageName,
  modelKeyFor
} from "../background/settings.js";
import { applyI18n, fillLangSelect } from "./ui.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function sendMsg(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message || "Connection failed" });
          return;
        }
        resolve(res || {});
      });
    } catch (e) {
      resolve({ error: e && e.message ? e.message : "Connection failed" });
    }
  });
}

let flashTimer = 0;
function flashSaved() {
  const node = $("saved-flash");
  node.classList.add("is-on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => node.classList.remove("is-on"), 1500);
}

let state = { ...DEFAULTS };

async function save(patch) {
  state = await setSettings(patch);
  flashSaved();
}

// ---- general / subtitles ----
const TOGGLES = ["enabled", "blurNative", "blurLearn", "hoverPause", "autoPause", "autoTranslate", "showSidebar"];

function renderToggles() {
  TOGGLES.forEach((k) => ($("opt-" + k).checked = !!state[k]));
  $("opt-site-youtube").checked = state.sites.youtube !== false;
  $("opt-site-netflix").checked = state.sites.netflix !== false;
  $("opt-site-generic").checked = state.sites.generic !== false;
  $("opt-font").value = String(state.fontScale || 1);
  $("opt-font-val").textContent = Math.round((state.fontScale || 1) * 100) + "%";
}

const saveFont = debounce((v) => save({ fontScale: v }), 200);

function bindToggles() {
  TOGGLES.forEach((k) => {
    $("opt-" + k).addEventListener("change", (e) => save({ [k]: !!e.target.checked }));
  });
  ["youtube", "netflix", "generic"].forEach((site) => {
    $("opt-site-" + site).addEventListener("change", (e) => {
      save({ sites: { ...state.sites, [site]: !!e.target.checked } });
    });
  });
  $("opt-font").addEventListener("input", (e) => {
    const v = Math.round(Number(e.target.value) * 100) / 100;
    $("opt-font-val").textContent = Math.round(v * 100) + "%";
    saveFont(v);
  });
}

// ---- languages ----
function renderLangs() {
  fillLangSelect($("opt-learnLang"), state.learnLang, true);
  fillLangSelect($("opt-nativeLang"), state.nativeLang, false);
}

function bindLangs() {
  $("opt-learnLang").addEventListener("change", (e) => save({ learnLang: e.target.value }));
  $("opt-nativeLang").addEventListener("change", (e) => save({ nativeLang: e.target.value }));
}

// ---- AI explanations ----
const KEY_HELP = {
  openrouter: [
    "Create a free OpenRouter key, then use a model id ending in :free (default is already free).",
    "https://openrouter.ai/keys",
    "Get an OpenRouter API key"
  ],
  gemini: ["Google AI Studio has a free tier.", "https://aistudio.google.com/apikey", "Get a Gemini API key"],
  anthropic: ["Usage is billed to your Anthropic account.", "https://console.anthropic.com/settings/keys", "Get an Anthropic API key"]
};

function setKeyVisible(visible) {
  $("opt-apikey").type = visible ? "text" : "password";
  $("btn-key-toggle").textContent = visible ? "Hide" : "Show";
  $("btn-key-toggle").setAttribute("aria-pressed", visible ? "true" : "false");
}

// Broad https://*/* already covers provider APIs — don't request redundant optional perms (Opera warns).
function requestAccess(provider) {
  const origin = PROVIDER_ORIGINS[provider];
  if (!origin) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: ["https://*/*"] }, (broad) => {
        if (chrome.runtime.lastError) {
          /* fall through */
        } else if (broad) {
          resolve(true);
          return;
        }
        chrome.permissions.contains({ origins: [origin] }, (have) => {
          if (have) {
            resolve(true);
            return;
          }
          try {
            chrome.permissions.request({ origins: [origin] }, (granted) => {
              void chrome.runtime.lastError;
              resolve(!!granted);
            });
          } catch (_) {
            resolve(false);
          }
        });
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function renderProviderDetail() {
  const provider = state.llmProvider;
  $("llm-detail").hidden = provider === "none";
  $("test-result").className = "test-result";
  $("test-result").textContent = "";
  if (provider === "none") return;
  $("opt-model").value = state[modelKeyFor(provider)] || DEFAULTS[modelKeyFor(provider)] || "";
  $("opt-apikey").value = await getApiKey(provider);
  setKeyVisible(false);
  const help = $("key-help");
  const [text, href, label] = KEY_HELP[provider] || [];
  help.textContent = text ? text + " " : "";
  if (href) {
    const a = el("a", "", label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    help.appendChild(a);
  }
}

const saveApiKey = debounce(async (provider, value) => {
  await setApiKey(provider, value);
  flashSaved();
}, 400);

const saveModel = debounce(async (provider, value) => {
  const name = value.trim();
  if (name) await save({ [modelKeyFor(provider)]: name });
}, 400);

async function runTest() {
  const provider = state.llmProvider;
  const out = $("test-result");
  const btn = $("btn-test");
  if (provider === "none") return;
  const apiKey = $("opt-apikey").value.trim();
  if (!apiKey) {
    out.className = "test-result is-error";
    out.textContent = "Enter an API key first";
    return;
  }
  const granted = await requestAccess(provider);
  if (!granted) {
    out.className = "test-result is-error";
    out.textContent = "Permission to contact the provider was not granted";
    return;
  }
  await setApiKey(provider, apiKey);
  btn.disabled = true;
  out.className = "test-result";
  out.textContent = "Testing…";
  const res = await sendMsg({ type: "testLlm", provider, apiKey, model: $("opt-model").value.trim() });
  btn.disabled = false;
  if (res && res.ok) {
    out.className = "test-result is-ok";
    out.textContent = `Connected · "double down on" → ${res.meaning || ""}${res.model ? ` (${res.model})` : ""}`;
  } else {
    out.className = "test-result is-error";
    out.textContent = (res && (res.error || res.message)) || "Connection failed";
  }
}

function bindLlm() {
  $("opt-provider").addEventListener("change", async (e) => {
    await save({ llmProvider: e.target.value });
    await renderProviderDetail();
  });
  $("opt-apikey").addEventListener("input", (e) => saveApiKey(state.llmProvider, e.target.value));
  // Saving a key (leaving the field / Enter) asks for access to that provider's API.
  $("opt-apikey").addEventListener("change", (e) => {
    if (e.target.value.trim()) requestAccess(state.llmProvider);
  });
  $("opt-model").addEventListener("input", (e) => saveModel(state.llmProvider, e.target.value));
  $("btn-key-toggle").addEventListener("click", () => setKeyVisible($("opt-apikey").type === "password"));
  $("btn-test").addEventListener("click", runTest);
  document.querySelectorAll('input[name="contextMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) save({ contextMode: input.value });
    });
  });
}

async function renderOsKey() {
  $("opt-os-key").value = await getApiKey("opensubtitles");
}

/** Test OpenSubtitles from the options page (avoids SW dying after permissions.request). */
async function probeOpenSubtitlesInPage(apiKey) {
  const params = new URLSearchParams({
    languages: "en",
    order_by: "download_count",
    order_direction: "desc",
    query: "matrix"
  });
  // Canonical order: languages, order_by, order_direction, query
  const qs = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v).replace(/%20/g, "+"))
    .join("&");
  const res = await fetch("https://api.opensubtitles.com/api/v1/subtitles?" + qs, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Api-Key": apiKey,
      "Content-Type": "application/json",
      "X-User-Agent": "DualCoach/" + chrome.runtime.getManifest().version
    },
    redirect: "follow"
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || "OpenSubtitles HTTP " + res.status;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  const count = Array.isArray(data && data.data) ? data.data.length : 0;
  return { ok: true, count };
}

function bindOpenSubtitles() {
  $("opt-os-key").addEventListener("input", (e) => saveApiKey("opensubtitles", e.target.value));
  $("opt-os-key").addEventListener("change", (e) => {
    if (e.target.value.trim()) requestAccess("opensubtitles");
  });
  $("btn-os-key-toggle").addEventListener("click", () => {
    const input = $("opt-os-key");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("btn-os-key-toggle").textContent = show ? "Hide" : "Show";
    $("btn-os-key-toggle").setAttribute("aria-pressed", show ? "true" : "false");
  });
  $("btn-os-test").addEventListener("click", async () => {
    const out = $("os-test-result");
    const btn = $("btn-os-test");
    const apiKey = $("opt-os-key").value.trim();
    if (!apiKey) {
      out.className = "test-result is-error";
      out.textContent = "Enter an API key first";
      return;
    }
    btn.disabled = true;
    out.className = "test-result";
    out.textContent = "Requesting permission…";
    const granted = await requestAccess("opensubtitles");
    if (!granted) {
      btn.disabled = false;
      out.className = "test-result is-error";
      out.textContent = "Permission to contact OpenSubtitles was not granted";
      return;
    }
    await setApiKey("opensubtitles", apiKey);
    out.textContent = "Testing…";
    try {
      // Prefer in-page fetch — granting optional host permission can restart the service worker
      // and close an in-flight sendMessage port ("message port closed before a response…").
      const res = await probeOpenSubtitlesInPage(apiKey);
      out.className = "test-result is-ok";
      out.textContent = `Connected · found ${Number(res.count) || 0} results for “matrix”`;
    } catch (e) {
      // Fallback via service worker once it is awake again
      await new Promise((r) => setTimeout(r, 250));
      const res = await sendMsg({ type: "osTest", apiKey });
      if (res && res.ok) {
        out.className = "test-result is-ok";
        out.textContent = `Connected · found ${Number(res.count) || 0} results for “matrix”`;
      } else {
        out.className = "test-result is-error";
        out.textContent =
          (res && (res.error || res.message)) ||
          (e && e.message) ||
          "Connection failed";
      }
    }
    btn.disabled = false;
  });
}

// ---- vocabulary ----
let vocab = [];

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return (h ? h + ":" + pad(m) : String(m)) + ":" + pad(s);
}

// Link that reopens the video at the saved line.
export function linkFor(item) {
  const t = Math.max(0, Math.floor(Number(item.time) || 0));
  let u;
  try {
    u = new URL(item.url);
  } catch (_) {
    return "";
  }
  if (item.site === "youtube" || /youtube\.com$/.test(u.hostname)) {
    u.searchParams.set("t", t + "s");
  } else if (item.site === "netflix" || /netflix\.com$/.test(u.hostname)) {
    u.search = "";
    u.searchParams.set("t", String(t));
  }
  return u.toString();
}

function renderVocab() {
  const body = $("vocab-body");
  body.textContent = "";
  $("vocab-empty").hidden = vocab.length > 0;
  $("vocab-table").hidden = vocab.length === 0;
  $("vocab-export").disabled = vocab.length === 0;
  $("vocab-anki").disabled = vocab.length === 0;
  $("vocab-clear").disabled = vocab.length === 0;

  vocab.forEach((item) => {
    const tr = el("tr");
    const term = el("td", "col-term term", item.text || "");
    if (item.lemma && item.lemma !== item.text) term.appendChild(el("span", "v-sent-nat", "→ " + item.lemma));
    term.title = [item.text, languageName(item.lang)].filter(Boolean).join(" · ");
    if (item.lang) term.lang = item.lang;
    tr.appendChild(term);

    const meaning = el("td", "col-meaning", item.meaning || "");
    meaning.title = item.meaning || "";
    tr.appendChild(meaning);

    const ctx = el("td", "col-context");
    ctx.appendChild(document.createTextNode(item.sentence || ""));
    if (item.sentenceNative) ctx.appendChild(el("span", "v-sent-nat", item.sentenceNative));
    ctx.title = [item.sentence, item.sentenceNative].filter(Boolean).join("\n");
    tr.appendChild(ctx);

    const title = el("td", "col-title", item.title || "");
    title.title = item.title || "";
    tr.appendChild(title);

    const linkTd = el("td", "col-link");
    const href = linkFor(item);
    if (href) {
      const a = el("a", "", fmtTime(item.time));
      a.href = href;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.title =
        "Open this scene" +
        (item.site === "netflix" ? " on Netflix" : item.site === "youtube" ? " on YouTube" : "");
      linkTd.appendChild(a);
    }
    tr.appendChild(linkTd);

    const act = el("td", "col-act");
    const btn = el("button", "btn btn-sm", "Delete");
    btn.type = "button";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const res = await sendMsg({ type: "vocabRemove", id: item.id });
      if (res && Array.isArray(res.items)) vocab = res.items;
      renderVocab();
    });
    act.appendChild(btn);
    tr.appendChild(act);
    body.appendChild(tr);
  });
}

async function loadVocab() {
  const res = await sendMsg({ type: "vocabList" });
  vocab = res && Array.isArray(res.items) ? res.items : [];
  renderVocab();
}

function csvCell(value) {
  const s = String(value == null ? "" : value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatDate(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number(ms) || Number.isNaN(d.getTime())) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function download(text, type, name) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fileBase() {
  return (chrome.i18n.getMessage("brand") || "vocab").toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-vocab";
}

export function buildCsv(items) {
  const rows = [["Word", "Lemma", "Language", "Meaning", "Sentence", "Sentence (translation)", "Video", "Link", "Saved"]];
  items.forEach((item) => {
    rows.push([
      item.text || "",
      item.lemma || "",
      item.lang || "",
      item.meaning || "",
      item.sentence || "",
      item.sentenceNative || "",
      item.title || "",
      linkFor(item),
      formatDate(item.savedAt)
    ]);
  });
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function htmlCell(s) {
  return String(s == null ? "" : s)
    .replace(/[\t\r\n]+/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Anki "Import File": tab-separated, HTML fields. Front = word + sentence, back = meaning + translated sentence.
export function buildAnkiTsv(items) {
  const lines = ["#separator:tab", "#html:true", "#columns:Front\tBack\tTags"];
  items.forEach((item) => {
    const word = htmlCell(item.text) + (item.lemma && item.lemma !== item.text ? " (" + htmlCell(item.lemma) + ")" : "");
    const front = "<b>" + word + "</b>" + (item.sentence ? "<br><br>" + htmlCell(item.sentence) : "");
    const back = htmlCell(item.meaning) + (item.sentenceNative ? "<br><br>" + htmlCell(item.sentenceNative) : "");
    const tags = [item.lang, item.site].filter(Boolean).join(" ");
    lines.push([front, back, tags].join("\t"));
  });
  return lines.join("\n") + "\n";
}

function bindVocab() {
  $("vocab-export").addEventListener("click", () => download(buildCsv(vocab), "text/csv;charset=utf-8;", fileBase() + ".csv"));
  $("vocab-anki").addEventListener("click", () => download(buildAnkiTsv(vocab), "text/tab-separated-values;charset=utf-8;", fileBase() + "-anki.tsv"));
  $("vocab-clear").addEventListener("click", async () => {
    if (!vocab.length) return;
    if (!confirm("Delete all saved words?")) return;
    const res = await sendMsg({ type: "vocabRemove", all: true });
    vocab = res && Array.isArray(res.items) ? res.items : [];
    renderVocab();
  });
}

// ---- cache ----
function bindCache() {
  const btn = $("cache-clear");
  btn.addEventListener("click", async () => {
    const out = $("cache-result");
    btn.disabled = true;
    out.className = "msg";
    out.textContent = "Clearing…";
    const res = await sendMsg({ type: "clearCache" });
    btn.disabled = false;
    if (res && res.error) {
      out.className = "msg msg-error";
      out.textContent = res.error;
      return;
    }
    out.textContent = `Removed ${Number(res && res.cleared) || 0} entries`;
  });
}

// ---- boot ----
async function init() {
  applyI18n();
  document.title = (chrome.i18n.getMessage("brand") || "") + " settings";
  $("about-version").textContent = chrome.runtime.getManifest().version;
  state = await getSettings();
  renderToggles();
  renderLangs();
  const ctx = document.querySelector(`input[name="contextMode"][value="${state.contextMode}"]`);
  if (ctx) ctx.checked = true;
  $("opt-provider").value = state.llmProvider || "none";
  await renderProviderDetail();
  await renderOsKey();

  bindToggles();
  bindLangs();
  bindLlm();
  bindOpenSubtitles();
  bindVocab();
  bindCache();
  await loadVocab();

  // Keep in sync when shortcuts (E/Q/T) or the popup change settings.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      state = { ...state, ...(changes.settings.newValue || {}) };
      renderToggles();
      renderLangs();
    }
    if (area === "local" && changes.vocab) loadVocab();
  });
}

init();
