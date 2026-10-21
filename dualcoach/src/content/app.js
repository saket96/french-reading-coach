// Boot: pick the site adapter, follow settings.
(function () {
  "use strict";
  var DC = window.DC;
  if (!DC || DC.booted) return;
  DC.booted = true;

  var host = location.hostname;
  var site = /(^|\.)youtube\.com$/.test(host)
    ? "youtube"
    : /(^|\.)netflix\.com$/.test(host)
      ? "netflix"
      : "generic";

  try {
    DC.debug = sessionStorage.getItem("dc.debug") === "1";
  } catch (_) {
    /* ignore */
  }

  var adapter = null;
  DC.running = false;

  function wanted() {
    if (!DC.settings.enabled) return false;
    var sites = DC.settings.sites || {};
    if (site === "youtube") return sites.youtube !== false;
    if (site === "netflix") return sites.netflix !== false;
    return sites.generic !== false;
  }

  function makeAdapter() {
    if (site === "youtube") return DC.youtube();
    if (site === "netflix") return DC.netflix();
    return DC.generic();
  }

  function sync(prev) {
    var want = wanted();
    if (want && !DC.running) {
      DC.running = true;
      if (!adapter) adapter = makeAdapter();
      adapter.start();
    } else if (!want && DC.running) {
      DC.running = false;
      if (adapter) adapter.stop();
    } else if (want && adapter) {
      adapter.applySettings(prev);
    }
  }

  DC.loadSettings().then(function () {
    sync(null);
    DC.refreshLlm();
  });

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && changes.settings) {
        var prev = DC.settings;
        DC.settings = DC.mergeSettings(changes.settings.newValue);
        sync(prev);
        if (DC.card.isOpen()) DC.card.rerender();
      }
      if (
        area === "local" &&
        (changes.geminiApiKey || changes.anthropicApiKey || changes.openrouterApiKey)
      ) {
        DC.refreshLlm();
      }
    });
  } catch (_) {
    /* context invalidated */
  }

  // Toolbar popup asks for a status line.
  try {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || msg.type !== "status") return false;
      var ctl = adapter && adapter.ctl();
      sendResponse({
        site: site,
        running: DC.running,
        cues: ctl ? ctl.cueCount() : 0,
        label: DC.diag && DC.diag.label,
        note: DC.diag && DC.diag.note
      });
      return false;
    });
  } catch (_) {
    /* ignore */
  }

  // E2E/debug: read-only state dump via DOM attribute (isolated world is not reachable from the page).
  document.addEventListener("dc-debug-dump", function () {
    var ctl = adapter && adapter.ctl();
    var out = {
      diag: DC.diag || null,
      overlay: ctl ? ctl.snapshot() : null,
      settings: DC.settings,
      llmReady: DC.llmReady
    };
    document.documentElement.setAttribute("data-dc-debug", JSON.stringify(out));
  });
})();
