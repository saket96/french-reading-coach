// Shared settings defaults + accessors. Imported by the service worker, options page and toolbar popup.
// src/content/core.js mirrors DEFAULTS (classic script) — keep in sync.

export const DEFAULTS = {
  enabled: true,
  sites: { youtube: true, netflix: true, generic: true },
  learnLang: "fr", // French Reading Coach default; "auto" = video's spoken language
  nativeLang: "", // "" = browser UI language, resolved in merge()
  hoverPause: true,
  autoPause: false,
  blurNative: false,
  blurLearn: false,
  fontScale: 1,
  autoTranslate: true,
  showSidebar: true,
  llmProvider: "none", // "gemini" | "anthropic" | "openrouter" | "none"
  geminiModel: "gemini-2.5-flash-lite",
  anthropicModel: "claude-haiku-4-5",
  // OpenRouter free-tier models use the `:free` suffix — see https://openrouter.ai/models?q=free
  openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
  contextMode: "click" // "auto" | "click" | "off"
};

export const KEY_MAP = {
  gemini: "geminiApiKey",
  anthropic: "anthropicApiKey",
  openrouter: "openrouterApiKey",
  opensubtitles: "opensubtitlesApiKey"
};

export const PROVIDER_ORIGINS = {
  gemini: "https://generativelanguage.googleapis.com/*",
  anthropic: "https://api.anthropic.com/*",
  openrouter: "https://openrouter.ai/*",
  opensubtitles: "https://api.opensubtitles.com/*"
};

/** Settings field that stores the model id for a provider. */
export function modelKeyFor(provider) {
  if (provider === "anthropic") return "anthropicModel";
  if (provider === "openrouter") return "openrouterModel";
  return "geminiModel";
}

// Picker list (options + popup). "auto" is offered for learnLang only.
export const LANGS = ["es", "fr", "de", "it", "pt", "ja", "ko", "zh", "ru", "ar", "hi", "tr", "nl", "pl", "sv", "vi", "th", "id", "en"];

const LANG_NAME = {
  french: "fr",
  francais: "fr",
  français: "fr",
  english: "en",
  spanish: "es",
  espanol: "es",
  español: "es",
  german: "de",
  italian: "it",
  portuguese: "pt",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  russian: "ru",
  arabic: "ar",
  hindi: "hi",
  turkish: "tr",
  dutch: "nl",
  polish: "pl",
  swedish: "sv",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id"
};

export function baseLang(code) {
  const c = String(code || "").trim().toLowerCase().replace(/_/g, "-");
  if (!c || c === "auto" || c === "und" || c === "other") return "";
  if (LANG_NAME[c]) return LANG_NAME[c];
  const b = c.split("-")[0];
  if (LANG_NAME[b]) return LANG_NAME[b];
  return { iw: "he", in: "id", ji: "yi" }[b] || b;
}

let names = null;
export function languageName(code) {
  const b = baseLang(code);
  if (!b) return "";
  try {
    if (!names) names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(b) || b;
  } catch (_) {
    return b;
  }
}

export function uiLang() {
  try {
    return baseLang(chrome.i18n.getUILanguage()) || "en";
  } catch (_) {
    return "en";
  }
}

function merge(raw) {
  const s = { ...DEFAULTS, ...(raw || {}) };
  s.sites = { ...DEFAULTS.sites, ...((raw && raw.sites) || {}) };
  s.nativeLang = baseLang(s.nativeLang) || uiLang();
  s.learnLang = s.learnLang === "auto" ? "auto" : baseLang(s.learnLang) || "fr";
  return s;
}

export async function getSettings() {
  const got = await chrome.storage.sync.get("settings");
  return merge(got && got.settings);
}

export async function setSettings(patch) {
  const next = merge({ ...(await getSettings()), ...patch });
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export async function getApiKey(provider) {
  const name = KEY_MAP[provider];
  if (!name) return "";
  const got = await chrome.storage.local.get(name);
  return (got && got[name] ? String(got[name]) : "").trim();
}

export async function setApiKey(provider, value) {
  const name = KEY_MAP[provider];
  if (!name) return;
  const v = String(value || "").trim();
  if (v) await chrome.storage.local.set({ [name]: v });
  else await chrome.storage.local.remove(name);
}

// Provider APIs are covered by the extension's broad https://*/* host permission.
export async function hasProviderAccess(provider) {
  const origin = PROVIDER_ORIGINS[provider];
  if (!origin) return false;
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    // Manifest already grants http(s)://*/* — treat API hosts as allowed.
    if (await chrome.permissions.contains({ origins: ["https://*/*"] })) return true;
    if (await chrome.permissions.contains({ origins: ["<all_urls>"] })) return true;
  } catch (_) {
    /* ignore */
  }
  return false;
}

export function siteOf(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (/(^|\.)youtube\.com$/.test(h)) return "youtube";
    if (/(^|\.)netflix\.com$/.test(h)) return "netflix";
    if (u.protocol === "http:" || u.protocol === "https:") return "generic";
  } catch (_) {
    /* ignore */
  }
  return "";
}
