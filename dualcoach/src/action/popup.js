// Toolbar popup: global toggle, current-site toggle, languages, status line, options.

import { getSettings, setSettings, getApiKey, hasProviderAccess, siteOf } from "../background/settings.js";
import { applyI18n, fillLangSelect } from "../options/ui.js";

const $ = (id) => document.getElementById(id);
const SITE_LABEL = { youtube: "YouTube", netflix: "Netflix", generic: "This video site" };
const PROVIDER_LABEL = { openrouter: "OpenRouter", gemini: "Gemini", anthropic: "Claude" };

let site = "";
let tabId = 0;

function activeTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(Array.isArray(tabs) && tabs[0] ? tabs[0] : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function tabStatus() {
  return new Promise((resolve) => {
    if (!tabId) return resolve(null);
    try {
      chrome.tabs.sendMessage(tabId, { type: "status" }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function renderSite(settings) {
  const row = $("site-row");
  const input = $("site-enabled");
  if (!site) {
    row.classList.add("is-disabled");
    $("site-host").textContent = "This site";
    $("site-sub").textContent = "YouTube, Netflix, or HTML5 video sites";
    input.checked = false;
    input.disabled = true;
    return;
  }
  const on = settings.sites[site] !== false;
  row.classList.remove("is-disabled");
  $("site-host").textContent = SITE_LABEL[site];
  $("site-sub").textContent = on ? "Turn off on this site" : "Turn on for this site";
  input.checked = on;
  input.disabled = false;
}

async function renderStatus(settings) {
  const dot = $("status-dot");
  const text = $("status-text");
  dot.classList.remove("on");
  if (!settings.enabled) return void (text.textContent = "Turned off");
  if (!site) return void (text.textContent = "Not active on this page");
  if (settings.sites[site] === false) return void (text.textContent = "Off on " + SITE_LABEL[site]);
  const st = await tabStatus();
  if (!st) return void (text.textContent = "Reload the page to start");
  if (!st.cues) return void (text.textContent = st.running ? "Waiting for a video with subtitles" : "Not running");
  dot.classList.add("on");
  text.textContent = `${st.cues} lines · ${st.label || ""}`;
}

async function renderProvider(settings) {
  const provider = settings.llmProvider;
  const dot = $("provider-dot");
  const text = $("provider-text");
  const name = PROVIDER_LABEL[provider];
  dot.classList.remove("on");
  if (!name) return void (text.textContent = "AI explanations: off");
  let ready = false;
  try {
    ready = !!(await getApiKey(provider)) && (await hasProviderAccess(provider));
  } catch (_) {
    ready = false;
  }
  if (ready) dot.classList.add("on");
  text.textContent = "AI explanations: " + (ready ? name + " connected" : "set up in Settings");
}

async function renderAll() {
  const s = await getSettings();
  $("enabled").checked = !!s.enabled;
  fillLangSelect($("learnLang"), s.learnLang, true);
  fillLangSelect($("nativeLang"), s.nativeLang, false);
  renderSite(s);
  renderProvider(s);
  renderStatus(s);
}

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n();
  document.title = chrome.i18n.getMessage("brand") || "";
  const tab = await activeTab();
  tabId = (tab && tab.id) || 0;
  site = siteOf((tab && (tab.url || tab.pendingUrl)) || "");

  $("enabled").addEventListener("change", async (e) => {
    await setSettings({ enabled: !!e.target.checked });
    renderAll();
  });
  $("site-enabled").addEventListener("change", async (e) => {
    if (!site) return;
    const s = await getSettings();
    await setSettings({ sites: { ...s.sites, [site]: !!e.target.checked } });
    renderAll();
  });
  ["learnLang", "nativeLang"].forEach((key) => {
    $(key).addEventListener("change", async (e) => {
      await setSettings({ [key]: e.target.value });
      // The page re-plans its tracks; give it a moment before refreshing the status line.
      setTimeout(renderAll, 1500);
    });
  });
  $("open-options").addEventListener("click", () => {
    try {
      chrome.runtime.openOptionsPage(() => {
        void chrome.runtime.lastError;
        window.close();
      });
    } catch (_) {
      window.close();
    }
  });
  renderAll();
});
