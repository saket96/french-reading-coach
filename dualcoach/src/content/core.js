// Isolated-world core: namespace, page bridge, runtime messaging, settings.
(function () {
  "use strict";
  if (window.DC) return;

  // Mirror of src/background/settings.js DEFAULTS (module, cannot be imported here). Keep in sync.
  var DEFAULTS = {
    enabled: true,
    sites: { youtube: true, netflix: true, generic: true },
    learnLang: "auto",
    nativeLang: "",
    hoverPause: true,
    autoPause: false,
    blurNative: false,
    blurLearn: false,
    fontScale: 1,
    autoTranslate: true,
    showSidebar: true,
    llmProvider: "none",
    geminiModel: "gemini-2.5-flash-lite",
    anthropicModel: "claude-haiku-4-5",
    openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
    contextMode: "click"
  };

  var DC = (window.DC = {
    P: window.DC_PARSERS,
    DEFAULTS: DEFAULTS,
    settings: null,
    llmReady: false,
    debug: false
  });

  DC.msg = function (key) {
    try { return chrome.i18n.getMessage(key) || ""; } catch (_) { return ""; }
  };
  DC.brand = DC.msg("brand") || "DualCoach";

  function uiLang() {
    try { return DC.P.baseLang(chrome.i18n.getUILanguage()) || "en"; } catch (_) { return "en"; }
  }

  var names = null;
  DC.langName = function (code) {
    var b = DC.P.baseLang(code);
    if (!b) return "";
    try {
      if (!names) names = new Intl.DisplayNames(["en"], { type: "language" });
      return names.of(b) || b;
    } catch (_) {
      return b;
    }
  };

  DC.log = function () {
    if (!DC.debug) return;
    try { console.log.apply(console, ["[" + DC.brand + "]"].concat([].slice.call(arguments))); } catch (_) { /* ignore */ }
  };

  DC.esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  DC.sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  DC.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  };

  // Never throws: "Extension context invalidated" after a reload is a silent no-op.
  DC.send = function (msg) {
    return new Promise(function (resolve) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) return resolve(null);
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res);
        });
      } catch (_) {
        resolve(null);
      }
    });
  };

  // ---- page bridge (MAIN world hook) ----
  var pending = new Map();
  var listeners = {};
  var seq = 0;

  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.__dc !== true || d.dir !== "toContent") return;
    if (d.type === "REPLY") {
      var p = pending.get(d.key);
      if (!p) return;
      pending.delete(d.key);
      clearTimeout(p.timer);
      if (d.error) p.reject(new Error(d.error));
      else p.resolve(d.data);
      return;
    }
    (listeners[d.type] || []).forEach(function (fn) {
      try { fn(d); } catch (err) { DC.log("listener error", err); }
    });
  });

  DC.page = {
    request: function (type, data, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var key = "k" + Date.now().toString(36) + "_" + ++seq;
        var timer = setTimeout(function () {
          pending.delete(key);
          reject(new Error("page bridge timeout: " + type));
        }, timeoutMs || 15000);
        pending.set(key, { resolve: resolve, reject: reject, timer: timer });
        var msg = Object.assign({}, data || {}, { __dc: true, dir: "toPage", type: type, key: key });
        window.postMessage(msg, location.origin);
      });
    },
    on: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    }
  };

  // ---- settings ----
  function merge(raw) {
    var s = Object.assign({}, DEFAULTS, raw || {});
    s.sites = Object.assign({}, DEFAULTS.sites, (raw && raw.sites) || {});
    s.nativeLang = DC.P.baseLang(s.nativeLang) || uiLang();
    s.learnLang = s.learnLang === "auto" ? "auto" : DC.P.baseLang(s.learnLang) || "auto";
    return s;
  }
  DC.mergeSettings = merge;
  DC.settings = merge(null);

  DC.saveSettings = function (patch) {
    DC.settings = merge(Object.assign({}, DC.settings, patch));
    try {
      chrome.storage.sync.set({ settings: DC.settings });
    } catch (_) { /* ignore */ }
  };

  DC.loadSettings = function () {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get("settings", function (got) {
          if (!chrome.runtime.lastError) DC.settings = merge(got && got.settings);
          resolve(DC.settings);
        });
      } catch (_) {
        resolve(DC.settings);
      }
    });
  };

  DC.refreshLlm = function () {
    return DC.send({ type: "getState" }).then(function (res) {
      DC.llmReady = !!(res && res.hasKey);
    });
  };
})();
