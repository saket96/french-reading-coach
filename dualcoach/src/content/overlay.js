// Overlay controller: dual subtitle block, transcript sidebar, toast, sync loop, shortcuts.
// A site adapter supplies: site, container(), video(), seek(sec), pause(), play(), hideNative(bool),
// title(), link(sec), bottom (CSS length), sideBottom (CSS length).
(function () {
  "use strict";
  var DC = window.DC;
  var P = DC.P;
  var esc = DC.esc;
  var CHIP = { mt: "Auto-translated", asr: "Auto-generated" };
  var STOP_EVENTS = ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "wheel", "contextmenu", "touchstart"];

  DC.createOverlay = function (adapter) {
    var host = document.createElement("div");
    host.setAttribute("data-dualcoach", "");
    host.setAttribute("style", "all:initial;position:absolute;inset:0;pointer-events:none;z-index:2147483000;");
    var shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      "<style>" + DC.CSS + "</style>" +
      '<div class="root off">' +
      '<div class="stage">' +
      '<div class="subs" hidden><div class="line l1"><span class="box"></span></div>' +
      '<div class="line l2"><span class="box"></span><span class="chip" hidden></span></div>' +
      '<div class="line nt"><span class="note"></span></div></div>' +
      '<div class="tools"><button class="tb" data-act="side" type="button" title="Show or hide Script panel (T)">' + DC.SVG.list + "<span class=\"tb-label\">Script</span></button></div>" +
      '<div class="toast" role="status"></div>' +
      "</div>" +
      '<aside class="side">' +
      '<div class="side-resize" data-act="side-resize" title="Drag to resize video / panel"></div>' +
      '<div class="side-hd"><div class="side-brand"><div class="side-t">DualCoach</div><div class="side-sub"></div></div>' +
      '<button class="side-hide" data-act="side-close" type="button" title="Hide panel (T or Esc)">' +
      DC.SVG.close + "<span>Hide</span></button></div>" +
      '<div class="side-tabs">' +
      '<button class="stab on" data-tab="script" type="button">Script</button>' +
      '<button class="stab" data-tab="vocab" type="button">Vocab</button>' +
      "</div>" +
      '<div class="side-panes">' +
      '<div class="pane on" data-pane="script">' +
      '<div class="os-box">' +
      '<button class="os-toggle" data-os="toggle" type="button">' +
      '<span class="os-toggle-label">Add subtitles</span>' +
      '<span class="os-toggle-chevron" aria-hidden="true"></span>' +
      "</button>" +
      '<div class="os-quick" hidden></div>' +
      '<div class="os-body">' +
      '<p class="os-help">Search OpenSubtitles (API key + account in Settings), load .srt/.vtt, or translate lines on-device.</p>' +
      '<input class="os-q" type="search" placeholder="Movie or series title (e.g. Amélie)" spellcheck="false" />' +
      '<div class="os-actions">' +
      '<button class="os-btn" data-os="search" type="button">Search</button>' +
      '<button class="os-btn os-btn-primary" data-os="best" type="button">Load best dual</button>' +
      '<button class="os-btn os-btn-wide" data-os="add-native" type="button" hidden>Add translation</button>' +
      '<button class="os-btn os-btn-wide" data-os="mt" type="button" hidden>Translate lines (Chrome)</button>' +
      "</div>" +
      '<div class="os-files">' +
      '<label class="os-file">Learning .srt/.vtt<input type="file" class="os-file-learn" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" /></label>' +
      '<label class="os-file">Translation .srt/.vtt<input type="file" class="os-file-native" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" /></label>' +
      '<button class="os-btn" data-os="files" type="button">Load files</button>' +
      "</div>" +
      '<div class="os-status" hidden></div>' +
      '<div class="os-results"></div>' +
      "</div></div>" +
      '<div class="list" style="position:relative"></div></div>' +
      '<div class="pane" data-pane="vocab"><div class="list vocab-list"></div></div>' +
      "</div></aside>" +
      '<div class="layer"></div>' +
      "</div>";

    var $ = function (sel) { return shadow.querySelector(sel); };
    var root = $(".root"), subs = $(".subs"), l1Box = $(".l1 .box"), l2Line = $(".l2"), l2Box = $(".l2 .box");
    var chip = $(".chip"), ntLine = $(".nt"), note = $(".note"), toastEl = $(".toast");
    var sideBtn = $('[data-act="side"]'), sideSub = $(".side-sub");
    var list = $(".pane[data-pane='script'] .list");
    var vocabList = $(".vocab-list");
    var osBox = $(".os-box");
    var osBody = $(".os-body");
    var osQuick = $(".os-quick");
    var osToggle = $(".os-toggle");
    var osToggleLabel = $(".os-toggle-label");
    var osQ = $(".os-q");
    var osStatus = $(".os-status");
    var osResults = $(".os-results");
    var osFileLearn = $(".os-file-learn");
    var osFileNative = $(".os-file-native");
    var osAddNativeBtn = $('[data-os="add-native"]');
    var osMtBtn = $('[data-os="mt"]');
    var layer = $(".layer");
    var sideTab = "script";
    var osHits = [];
    var pendingLearnFile = "";
    var pendingNativeFile = "";
    var sideWidth = 400;
    var resizeDrag = null;
    var lineTranslator = null;
    var lineTranslatorKey = "";
    var mtBusy = false;
    var osToolsOpen = true;

    STOP_EVENTS.forEach(function (t) {
      host.addEventListener(t, function (e) { e.stopPropagation(); }, false);
    });

    var cues = [];
    var meta = {};
    var tokensCache = [];
    var curIdx = -2, curRow = -2;
    var raf = 0, watchdog = 0, toastTimer = 0, lastToast = "";
    var hiddenByUser = false;
    var nativeHidden = false;
    var overSubs = false, hoverPaused = false, studyPaused = false;
    var activeIdx = -1, autoPausedFor = -1;
    var lastUserScroll = 0;
    var drag = null, suppressClick = false;
    var video = null;
    var destroyed = false;
    var idleShell = false;
    var curWord = -2;
    var ro = null, roTarget = null;

    // ------------------------------------------------------------ mounting
    function ensureMounted() {
      var c = adapter.container();
      if (!c) return false;
      if (host.parentNode !== c) c.appendChild(host);
      if (roTarget !== c) {
        if (ro) ro.disconnect();
        ro = new ResizeObserver(applyFont);
        ro.observe(c);
        roTarget = c;
      }
      return true;
    }

    function applyFont() {
      var w = roTarget ? roTarget.clientWidth : 1280;
      var fs = 28 * (w / 1280) * (Number(DC.settings.fontScale) || 1);
      root.style.setProperty("--fs", Math.max(16, Math.min(40, fs)).toFixed(1) + "px");
      if (DC.card.isOpen()) DC.card.reposition();
    }

    function getVideo() {
      if (!video || !video.isConnected) {
        var v = adapter.video();
        if (v !== video) {
          if (video) video.removeEventListener("play", onPlay);
          if (video) video.removeEventListener("seeking", onSeeking);
          video = v;
          if (video) {
            video.addEventListener("play", onPlay);
            video.addEventListener("seeking", onSeeking);
          }
        }
      }
      return video;
    }

    function pauseForStudy() {
      studyPaused = true;
      try {
        adapter.pause();
      } catch (_) {
        /* ignore */
      }
      var v = getVideo();
      if (v && !v.paused) {
        try {
          v.pause();
        } catch (_) {
          /* ignore */
        }
      }
    }

    function onPlay() {
      // Movie sites often auto-resume after a scripted pause — hold it while the card is open
      // or while the pointer is over subtitles (hover-pause).
      if (studyPaused || DC.card.isOpen() || (hoverPaused && overSubs)) {
        try {
          adapter.pause();
        } catch (_) {
          /* ignore */
        }
        return;
      }
      hoverPaused = false;
      studyPaused = false;
    }
    function onSeeking() { activeIdx = -1; }

    function active() {
      return !destroyed && !hiddenByUser && DC.settings.enabled && (cues.length > 0 || idleShell);
    }

    function setNative(hide) {
      if (nativeHidden === hide) return;
      nativeHidden = hide;
      try { adapter.hideNative(hide); } catch (_) { /* ignore */ }
    }

    function syncVisibility() {
      var on = active();
      root.classList.toggle("off", !on);
      setNative(on);
      if (!on && DC.card.isOpen()) DC.card.close();
    }

    // ------------------------------------------------------------ rendering
    function wordsHtml(text, tokens) {
      var out = "";
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        out += t.w ? '<span class="w" data-i="' + i + '">' + esc(t.text) + "</span>" : esc(t.text);
      }
      return out;
    }

    function tokensOf(idx) {
      if (!tokensCache[idx]) tokensCache[idx] = P.tokenize(cues[idx].src, meta.learnLang);
      return tokensCache[idx];
    }

    function hasNativeTrack() {
      for (var i = 0; i < cues.length; i++) {
        if (cues[i] && cues[i].nat) return true;
      }
      return false;
    }

    function nativeLangLabel() {
      return DC.langName(DC.settings.nativeLang || meta.nativeLang || "en") || "English";
    }

    function setOsToolsOpen(open) {
      // Always show tools when there are no cues yet
      osToolsOpen = !cues.length ? true : !!open;
      if (osBox) osBox.classList.toggle("os-collapsed", cues.length > 0 && !osToolsOpen);
      if (osToggle) {
        osToggle.setAttribute("aria-expanded", osToolsOpen ? "true" : "false");
        if (osToggleLabel) {
          osToggleLabel.textContent = !cues.length
            ? "Add subtitles"
            : osToolsOpen
              ? "Subtitle sources"
              : "Change subtitles";
        }
      }
      refreshNativeActions();
    }

    function refreshNativeActions() {
      var need = cues.length > 0 && !hasNativeTrack();
      if (osAddNativeBtn) {
        osAddNativeBtn.hidden = !need;
        osAddNativeBtn.textContent = "Add " + nativeLangLabel() + " (OpenSubtitles)";
      }
      if (osMtBtn) {
        osMtBtn.hidden = !need;
        osMtBtn.textContent = "Translate lines → " + nativeLangLabel();
      }
      // Compact actions stay visible when the big form is collapsed
      if (osQuick) {
        if (need && cues.length && !osToolsOpen) {
          osQuick.hidden = false;
          osQuick.innerHTML =
            '<button class="os-chip" data-os="add-native" type="button">Add ' +
            esc(nativeLangLabel()) +
            "</button>" +
            '<button class="os-chip" data-os="mt" type="button">Translate</button>' +
            '<button class="os-chip os-chip-muted" data-os="toggle" type="button">Sources</button>';
        } else {
          osQuick.hidden = true;
          osQuick.innerHTML = "";
        }
      }
    }

    function renderCue(idx) {
      curIdx = idx;
      if (idx < 0) { subs.hidden = true; return; }
      var c = cues[idx];
      l1Box.innerHTML = wordsHtml(c.src, tokensOf(idx));
      l1Box.parentNode.setAttribute("data-cue", String(idx));
      l1Box.setAttribute("lang", meta.learnLang || "");
      l2Box.textContent = c.nat || "";
      l2Box.setAttribute("lang", meta.nativeLang || "");
      l2Line.hidden = !c.nat;
      chip.textContent = CHIP[meta.nativeKind] || "";
      chip.hidden = !(c.nat && CHIP[meta.nativeKind]);
      if (meta.note && !c.nat) {
        note.innerHTML =
          esc(meta.note) +
          ' <button type="button" class="note-act" data-os="add-native">Add ' +
          esc(nativeLangLabel()) +
          "</button>" +
          ' <button type="button" class="note-act" data-os="mt">Translate</button>';
        ntLine.hidden = false;
      } else {
        note.textContent = meta.note || "";
        ntLine.hidden = !meta.note;
      }
      subs.hidden = false;
      if (meta.nativeKind === "mt" && c.src && !c.nat && !mtBusy) {
        ensureLineTranslated(idx);
      }
    }

    function setSideTab(name) {
      sideTab = name === "vocab" ? "vocab" : "script";
      shadow.querySelectorAll(".stab").forEach(function (el) {
        el.classList.toggle("on", el.getAttribute("data-tab") === sideTab);
      });
      shadow.querySelectorAll(".pane").forEach(function (el) {
        el.classList.toggle("on", el.getAttribute("data-pane") === sideTab);
      });
      if (sideTab === "vocab") buildVocab();
    }

    function guessTitle() {
      try {
        if (typeof adapter.title === "function") {
          var fromAdapter = String(adapter.title() || "").trim();
          if (fromAdapter) return cleanupTitle(fromAdapter);
        }
      } catch (_) {
        /* ignore */
      }
      var h =
        document.querySelector("h1") ||
        document.querySelector("[class*='title' i]") ||
        document.querySelector("meta[property='og:title']");
      if (h) {
        var t = h.getAttribute ? h.getAttribute("content") || h.textContent : h.textContent;
        if (t && t.trim()) return cleanupTitle(t);
      }
      return cleanupTitle(document.title || "");
    }

    function cleanupTitle(raw) {
      var t = String(raw || "")
        .replace(/\s*[-–|•].*$/, "")
        .replace(/\(\d{4}\)/g, " ")
        .replace(/\b(watch|online|free|hd|1080p|720p|movie|film)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      return t.slice(0, 140);
    }

    function parseSeasonEpisode(q) {
      var m = /\b[sS](\d{1,2})[eE](\d{1,2})\b/.exec(q);
      if (!m) return {};
      return { season: Number(m[1]), episode: Number(m[2]) };
    }

    function setOsStatus(msg, kind) {
      if (!osStatus) return;
      if (!msg) {
        osStatus.hidden = true;
        osStatus.textContent = "";
        return;
      }
      osStatus.hidden = false;
      osStatus.textContent = msg;
      osStatus.className = "os-status" + (kind ? " " + kind : "");
    }

    function renderOsResults(results) {
      osHits = results || [];
      if (!osResults) return;
      if (!osHits.length) {
        osResults.innerHTML = '<div class="os-empty">No results. Try a shorter title, or add S01E02 for series.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < Math.min(osHits.length, 12); i++) {
        var r = osHits[i];
        html +=
          '<button class="os-hit" type="button" data-os-file="' +
          r.fileId +
          '" data-os-lang="' +
          esc(r.language || "") +
          '">' +
          '<span class="os-lang">' +
          esc((r.language || "?").toUpperCase()) +
          "</span>" +
          '<span class="os-meta"><span class="os-title">' +
          esc(r.title || r.release || "Subtitle") +
          "</span>" +
          '<span class="os-sub">' +
          esc(r.release || "") +
          (r.downloads ? " · " + r.downloads + " downloads" : "") +
          "</span></span></button>";
      }
      osResults.innerHTML = html;
    }

    async function osSearch() {
      var q = (osQ && osQ.value.trim()) || guessTitle();
      if (osQ && !osQ.value.trim()) osQ.value = q;
      if (!q) {
        setOsStatus("Enter a movie or series title", "err");
        return;
      }
      setOsStatus("Searching OpenSubtitles…");
      osResults.innerHTML = "";
      var se = parseSeasonEpisode(q);
      var res = await DC.send({
        type: "osSearch",
        query: q,
        learnLang: DC.settings.learnLang,
        nativeLang: DC.settings.nativeLang,
        season: se.season,
        episode: se.episode
      });
      if (!res || res.error) {
        setOsStatus((res && res.error) || "Search failed — add an API key in Settings", "err");
        return;
      }
      setOsStatus((res.total || res.results.length) + " results · click one, or Load best dual");
      renderOsResults(res.results || []);
    }

    function putCues(list_, meta_) {
      var hadCues = cues.length > 0;
      cues = list_ || [];
      meta = meta_ || {};
      idleShell = false;
      tokensCache = [];
      curIdx = -2;
      curWord = -2;
      activeIdx = -1;
      autoPausedFor = -1;
      if (DC.card.isOpen()) DC.card.close();
      // First successful load → collapse the form so the script fills the panel
      if (cues.length && !hadCues) osToolsOpen = false;
      if (!cues.length) osToolsOpen = true;
      ensureMounted();
      buildSidebar();
      applySettings();
      refreshNativeActions();
      startLoop();
    }

    function mergeNativeText(nativeText, nativeLang, kind, labelSuffix) {
      if (!cues.length || !nativeText) return false;
      var natCues = P.parseSubtitleText(nativeText, "os.srt");
      if (!natCues.length) return false;
      var learnCues = cues.map(function (c) {
        return { start: c.start, end: c.end, text: c.src };
      });
      var aligned = P.alignCues(learnCues, natCues, false);
      putCues(aligned, {
        learnLang: meta.learnLang || DC.settings.learnLang,
        nativeLang: nativeLang || DC.settings.nativeLang,
        nativeKind: kind || "opensubtitles",
        label: (meta.label || "Script") + (labelSuffix || " + translation"),
        note: ""
      });
      return true;
    }

    async function applyOsTexts(learnText, nativeText, learnLang, nativeLang, label) {
      var learnCues = P.parseSubtitleText(learnText || "", "os.srt");
      if (!learnCues.length) {
        setOsStatus("Could not parse that subtitle file", "err");
        return false;
      }
      var natCues = nativeText ? P.parseSubtitleText(nativeText, "os.srt") : [];
      var aligned = P.alignCues(
        learnCues.map(function (c) {
          return { start: c.start, end: c.end, text: P.cleanCC(c.text) };
        }),
        natCues.map(function (c) {
          return { start: c.start, end: c.end, text: P.cleanCC(c.text) };
        }),
        false
      );
      var fixed = P.fixCaseLines(
        aligned.map(function (c) {
          return c.src;
        })
      );
      aligned.forEach(function (c, i) {
        c.src = fixed[i];
      });
      var natLang = nativeLang || DC.settings.nativeLang;
      putCues(aligned, {
        learnLang: learnLang || DC.settings.learnLang,
        nativeLang: natLang,
        nativeKind: natCues.length ? "opensubtitles" : "",
        label: label || "OpenSubtitles",
        note: natCues.length
          ? ""
          : "No " + (DC.langName(natLang) || natLang || "translation") + " track — add OpenSubtitles or Translate"
      });
      toast("Loaded " + (label || "OpenSubtitles"), 3500);
      setOsStatus(
        natCues.length
          ? "Loaded " + aligned.length + " dual lines"
          : "Loaded " + aligned.length + " lines · add " + (DC.langName(natLang) || "translation"),
        natCues.length ? "ok" : ""
      );
      refreshNativeActions();
      return true;
    }

    async function osAddNative() {
      if (!cues.length) {
        setOsStatus("Load a learning-language track first", "err");
        return;
      }
      if (hasNativeTrack()) {
        setOsStatus("Translation already loaded", "ok");
        return;
      }
      var q = (osQ && osQ.value.trim()) || guessTitle();
      if (osQ && !osQ.value.trim()) osQ.value = q;
      if (!q) {
        setOsStatus("Enter a movie title, then Add translation", "err");
        return;
      }
      var natLang = DC.settings.nativeLang || meta.nativeLang || "en";
      setOsStatus("Finding " + (DC.langName(natLang) || natLang) + " on OpenSubtitles…");
      var se = parseSeasonEpisode(q);
      var res = await DC.send({
        type: "osLoadNative",
        query: q,
        nativeLang: natLang,
        season: se.season,
        episode: se.episode
      });
      if (!res || res.error || !(res.native && res.native.text)) {
        setOsStatus(
          ((res && res.error) || "No OpenSubtitles track") + " — try Translate lines",
          "err"
        );
        refreshNativeActions();
        return;
      }
      if (
        mergeNativeText(
          res.native.text,
          res.nativeLang || natLang,
          "opensubtitles",
          " + " + (DC.langName(res.nativeLang || natLang) || "translation")
        )
      ) {
        setOsStatus(
          "Added " +
            (DC.langName(res.nativeLang || natLang) || "translation") +
            (res.remaining != null ? " · " + res.remaining + " downloads left" : ""),
          "ok"
        );
        toast("Added " + (DC.langName(res.nativeLang || natLang) || "translation"), 2500);
      } else {
        setOsStatus("Could not parse that translation file", "err");
      }
      refreshNativeActions();
    }

    async function getLineTranslator(src, tgt, onProgress) {
      if (!("Translator" in self)) throw new Error("unavailable");
      var key = src + ">" + tgt;
      if (lineTranslator && lineTranslatorKey === key) return lineTranslator;
      var avail = await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
      if (["available", "downloadable", "downloading"].indexOf(avail) === -1) {
        throw new Error("unavailable");
      }
      lineTranslatorKey = key;
      lineTranslator = await self.Translator.create({
        sourceLanguage: src,
        targetLanguage: tgt,
        monitor: function (m) {
          m.addEventListener("downloadprogress", function (ev) {
            if (onProgress) onProgress(ev.loaded || 0);
          });
        }
      });
      return lineTranslator;
    }

    async function ensureLineTranslated(idx) {
      var c = cues[idx];
      if (!c || c.nat || !c.src) return;
      var src = P.baseLang(meta.learnLang || DC.settings.learnLang);
      var tgt = P.baseLang(meta.nativeLang || DC.settings.nativeLang || "en");
      if (!src || !tgt || P.sameLang(src, tgt)) return;
      try {
        var t = await getLineTranslator(src, tgt);
        var out = await t.translate(c.src);
        if (!cues[idx] || cues[idx] !== c) return;
        c.nat = out;
        if (curIdx === idx) renderCue(idx);
        if (root.classList.contains("side-open")) buildSidebar();
      } catch (_) {
        /* ignore single-line failures */
      }
    }

    async function osMachineTranslate() {
      if (!cues.length) {
        setOsStatus("Load a learning-language track first", "err");
        return;
      }
      if (hasNativeTrack() && meta.nativeKind !== "mt") {
        setOsStatus("A subtitle translation is already loaded", "ok");
        return;
      }
      var src = P.baseLang(meta.learnLang || DC.settings.learnLang);
      var tgt = P.baseLang(DC.settings.nativeLang || meta.nativeLang || "en");
      if (!src || src === "auto" || src === "und") src = "fr";
      if (!tgt) tgt = "en";
      if (P.sameLang(src, tgt)) {
        setOsStatus("Learning and translation languages are the same", "err");
        return;
      }
      if (!("Translator" in self)) {
        setOsStatus(
          "Chrome on-device Translator not available — click an EN result above, or update Chrome",
          "err"
        );
        return;
      }
      mtBusy = true;
      setOsStatus("Translating lines with Chrome (on-device)…");
      try {
        var t = await getLineTranslator(src, tgt, function (p) {
          setOsStatus("Downloading translation model… " + Math.round(p * 100) + "%");
        });
        var done = 0;
        var total = cues.length;
        // Translate in small batches so the UI stays responsive
        for (var i = 0; i < cues.length; i++) {
          if (!cues[i].nat && cues[i].src) {
            try {
              cues[i].nat = await t.translate(cues[i].src);
            } catch (_) {
              /* skip line */
            }
          }
          done++;
          if (done % 25 === 0 || done === total) {
            setOsStatus("Translated " + done + " / " + total + " lines…");
          }
        }
        meta.nativeLang = tgt;
        meta.nativeKind = "mt";
        meta.note = "";
        meta.label =
          (DC.langName(src) || src) + " + " + (DC.langName(tgt) || tgt) + " (Chrome translate)";
        buildSidebar();
        if (curIdx >= 0) renderCue(curIdx);
        setOsStatus("Translated " + total + " lines on-device", "ok");
        toast("Showing Chrome translation under each line", 3000);
      } catch (e) {
        var msg = (e && e.message) || "";
        setOsStatus(
          msg === "unavailable"
            ? "This language pair isn’t supported by Chrome Translator — click an EN OpenSubtitles result"
            : "Translation failed — try an EN file from the search results",
          "err"
        );
      }
      mtBusy = false;
      refreshNativeActions();
    }

    async function osLoadBest() {
      var q = (osQ && osQ.value.trim()) || guessTitle();
      if (osQ && !osQ.value.trim()) osQ.value = q;
      if (!q) {
        setOsStatus("Enter a movie or series title", "err");
        return;
      }
      setOsStatus("Downloading best dual tracks…");
      var se = parseSeasonEpisode(q);
      var learn =
        DC.settings.learnLang === "auto"
          ? meta.learnLang && meta.learnLang !== "auto"
            ? meta.learnLang
            : "fr"
          : DC.settings.learnLang;
      var res = await DC.send({
        type: "osLoadBest",
        query: q,
        learnLang: learn,
        nativeLang: DC.settings.nativeLang,
        season: se.season,
        episode: se.episode
      });
      if (!res || res.error) {
        setOsStatus((res && res.error) || "Download failed", "err");
        return;
      }
      var label =
        DC.langName(res.learnLang) +
        (res.native ? " + " + DC.langName(res.nativeLang) : " only") +
        " · OpenSubtitles";
      await applyOsTexts(
        res.learn && res.learn.text,
        res.native && res.native.text,
        res.learnLang,
        res.nativeLang,
        label
      );
      if (!res.native) {
        setOsStatus(
          "Loaded " +
            (DC.langName(res.learnLang) || res.learnLang) +
            " only — Add " +
            nativeLangLabel() +
            " or Translate lines",
          ""
        );
      } else if (res.remaining != null) {
        setOsStatus("Loaded · " + res.remaining + " downloads left today", "ok");
      }
    }

    function readFileAsText(file) {
      return new Promise(function (resolve, reject) {
        if (!file) return resolve("");
        var reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result || ""));
        };
        reader.onerror = function () {
          reject(new Error("Could not read " + (file.name || "file")));
        };
        reader.readAsText(file);
      });
    }

    async function osLoadLocalFiles() {
      try {
        var learnText = pendingLearnFile;
        var nativeText = pendingNativeFile;
        if (osFileLearn && osFileLearn.files && osFileLearn.files[0]) {
          learnText = await readFileAsText(osFileLearn.files[0]);
          pendingLearnFile = learnText;
        }
        if (osFileNative && osFileNative.files && osFileNative.files[0]) {
          nativeText = await readFileAsText(osFileNative.files[0]);
          pendingNativeFile = nativeText;
        }
        if (!learnText) {
          setOsStatus("Choose a learning-language .srt or .vtt file first", "err");
          return;
        }
        var learnLang = DC.settings.learnLang === "auto" ? "und" : DC.settings.learnLang;
        var nativeLang = DC.settings.nativeLang;
        var label =
          (DC.langName(learnLang) || "Learning") +
          (nativeText ? " + " + (DC.langName(nativeLang) || "Translation") : " only") +
          " · local file";
        setOsStatus("Loading local subtitles…");
        await applyOsTexts(learnText, nativeText, learnLang, nativeLang, label);
      } catch (e) {
        setOsStatus((e && e.message) || "Could not load those files", "err");
      }
    }

    async function osLoadFile(fileId, lang) {
      setOsStatus("Downloading…");
      var res = await DC.send({ type: "osDownload", fileId: fileId });
      if (!res || res.error) {
        setOsStatus((res && res.error) || "Download failed", "err");
        return;
      }
      var learnLang = lang || DC.settings.learnLang;
      var nativeLang = DC.settings.nativeLang;
      // Any non-learning language clicked while cues exist → add as translation (EN, etc.)
      if (cues.length && lang && meta.learnLang && !P.sameLang(lang, meta.learnLang)) {
        if (
          mergeNativeText(
            res.text,
            lang || nativeLang,
            "opensubtitles",
            " + " + (DC.langName(lang) || lang)
          )
        ) {
          setOsStatus("Added " + (DC.langName(lang) || lang) + " translation", "ok");
          toast("Added " + (DC.langName(lang) || lang), 2500);
          refreshNativeActions();
          return;
        }
      }
      await applyOsTexts(
        res.text,
        "",
        learnLang,
        nativeLang,
        (DC.langName(learnLang) || learnLang) + " · OpenSubtitles"
      );
    }

    function buildSidebar() {
      sideSub.textContent = cues.length ? cues.length + " lines · " + (meta.label || "Script") : "Script panel";
      if (osQ && !osQ.value) osQ.value = guessTitle();
      if (osBox) osBox.hidden = false;
      setOsToolsOpen(osToolsOpen);
      if (!cues.length) {
        list.innerHTML =
          '<div class="empty">No subtitles yet. Search OpenSubtitles above, or load .srt / .vtt files.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < cues.length; i++) {
        var c = cues[i];
        html +=
          '<div class="row" data-cue="' +
          i +
          '"><div class="ts">' +
          DC.fmtTime(c.start) +
          '</div><div class="rt">' +
          '<div class="r-l1" data-cue="' +
          i +
          '" lang="' +
          esc(meta.learnLang || "") +
          '">' +
          wordsHtml(c.src, tokensOf(i)) +
          "</div>" +
          (c.nat ? '<div class="r-l2">' + esc(c.nat) + "</div>" : "") +
          "</div></div>";
      }
      list.innerHTML = html;
      curRow = -2;
    }

    function buildVocab() {
      if (!vocabList) return;
      vocabList.innerHTML = '<div class="empty">Loading vocabulary…</div>';
      try {
        chrome.runtime.sendMessage({ type: "vocabList" }, function (res) {
          if (chrome.runtime.lastError) {
            vocabList.innerHTML = '<div class="empty">Could not load vocabulary.</div>';
            return;
          }
          var items = res && Array.isArray(res.items) ? res.items : [];
          if (!items.length) {
            vocabList.innerHTML =
              '<div class="empty">No saved words yet. Click a word in the script or subtitles, then tap the bookmark icon.</div>';
            return;
          }
          // Newest first
          items = items.slice().sort(function (a, b) {
            return (b.savedAt || 0) - (a.savedAt || 0);
          });
          var html = "";
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var canJump = typeof it.time === "number" && isFinite(it.time);
            html +=
              '<div class="vrow">' +
              '<div class="v-term">' +
              esc(it.text || "") +
              "</div>" +
              (it.meaning ? '<div class="v-mean">' + esc(it.meaning) + "</div>" : "") +
              (it.sentence ? '<div class="v-sent">' + esc(it.sentence) + "</div>" : "") +
              '<div class="v-meta"><span>' +
              esc(it.title || it.site || "") +
              "</span>" +
              (canJump
                ? '<button class="v-jump" type="button" data-jump-time="' +
                  Number(it.time) +
                  '">Jump ' +
                  DC.fmtTime(it.time) +
                  "</button>"
                : "") +
              "</div></div>";
          }
          vocabList.innerHTML = html;
        });
      } catch (_) {
        vocabList.innerHTML = '<div class="empty">Could not load vocabulary.</div>';
      }
    }

    function highlightRow(idx) {
      if (idx === curRow) return;
      var prev = list.querySelector(".row.cur");
      if (prev) prev.classList.remove("cur");
      curRow = idx;
      if (idx < 0) return;
      var row = list.children[idx];
      if (!row) return;
      row.classList.add("cur");
      if (root.classList.contains("side-open") && Date.now() - lastUserScroll > 3000) {
        list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
      }
    }

    function clampSideWidth(px, hostW) {
      var max = Math.max(280, Math.floor((hostW || 800) * 0.7));
      return Math.max(260, Math.min(max, Math.round(px)));
    }

    function applySideWidth(px, persist) {
      var hostW = (host.parentElement && host.parentElement.clientWidth) || window.innerWidth || 800;
      sideWidth = clampSideWidth(px, hostW);
      root.style.setProperty("--side-w", sideWidth + "px");
      if (persist) {
        try {
          chrome.storage.local.set({ dcSideWidth: sideWidth });
        } catch (_) {
          /* ignore */
        }
      }
    }

    function applySettings() {
      var s = DC.settings;
      root.classList.toggle("blur-nat", !!s.blurNative);
      root.classList.toggle("blur-learn", !!s.blurLearn);
      root.classList.toggle("side-open", !!s.showSidebar);
      sideBtn.classList.toggle("on", !!s.showSidebar);
      var label = sideBtn.querySelector(".tb-label");
      if (label) label.textContent = s.showSidebar ? "Hide" : "Script";
      sideBtn.title = s.showSidebar ? "Hide Script panel (T)" : "Show Script panel (T)";
      root.style.setProperty("--bottom", adapter.bottom || "10%");
      root.style.setProperty("--side-bottom", adapter.sideBottom || "0px");
      applySideWidth(sideWidth, false);
      applyFont();
      syncVisibility();
      refreshNativeActions();
      if (s.showSidebar) {
        lastUserScroll = 0;
        curRow = -2;
        if (sideTab === "vocab") buildVocab();
      }
    }

    function toast(msg, ms) {
      if (!msg) return;
      ensureMounted();
      lastToast = msg;
      toastEl.textContent = msg;
      toastEl.classList.add("on");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, ms || 3000);
    }

    // ------------------------------------------------------------ loop
    function tick() {
      raf = requestAnimationFrame(tick);
      if (!active()) return;
      var v = getVideo();
      if (!v) return;
      var t = v.currentTime;
      var idx = P.findCue(cues, t);

      if (DC.settings.autoPause && !v.paused && !v.seeking) {
        var c = activeIdx >= 0 ? cues[activeIdx] : null;
        if (c && autoPausedFor !== activeIdx && t >= c.end - 0.05 && t < c.end + 0.6) {
          autoPausedFor = activeIdx;
          adapter.pause();
        } else if (idx !== -1) activeIdx = idx;
      } else if (idx !== -1) activeIdx = idx;

      if (idx !== curIdx && !(drag || DC.card.isOpen())) renderCue(idx);
      if (root.classList.contains("side-open")) highlightRow(P.floorCue(cues, t));
      if (idx >= 0 && !(drag || DC.card.isOpen())) highlightKaraoke(idx, t);
    }

    function wordsForCue(idx) {
      var c = cues[idx];
      if (!c) return [];
      if (c.words && c.words.length) return c.words;
      c.words = P.estimateWordTimings(c.src, c.start, c.end, meta.learnLang);
      return c.words || [];
    }

    function highlightKaraoke(cueIdx, t) {
      var words = wordsForCue(cueIdx);
      var wi = P.activeWordIndex(words, t);
      if (wi === curWord && cueIdx === curIdx) return;
      curWord = wi;
      var tokenIdx = -1;
      if (wi >= 0) {
        var toks = tokensOf(cueIdx);
        var n = 0;
        for (var i = 0; i < toks.length; i++) {
          if (!toks[i].w) continue;
          if (n === wi) {
            tokenIdx = i;
            break;
          }
          n++;
        }
      }
      function paint(rootEl) {
        if (!rootEl) return;
        rootEl.querySelectorAll(".w.kar").forEach(function (el) {
          el.classList.remove("kar");
        });
        if (tokenIdx < 0) return;
        var el = rootEl.querySelector('.w[data-i="' + tokenIdx + '"]');
        if (el) el.classList.add("kar");
      }
      paint(l1Box);
      if (root.classList.contains("side-open") && cueIdx >= 0) {
        var row = list.children[cueIdx];
        paint(row && row.querySelector(".r-l1"));
      }
    }

    function startLoop() {
      if (!raf) raf = requestAnimationFrame(tick);
      if (!watchdog) watchdog = setInterval(function () {
        if (cues.length || toastEl.classList.contains("on")) ensureMounted();
      }, 1000);
    }

    // ------------------------------------------------------------ navigation
    function seekTo(idx, thenPlay) {
      if (idx < 0 || idx >= cues.length) return;
      autoPausedFor = -1;
      activeIdx = -1;
      adapter.seek(cues[idx].start + 0.01);
      renderCue(idx);
      if (thenPlay) adapter.play();
    }

    function nav(dir) {
      var v = getVideo();
      if (!v || !cues.length) return;
      var t = v.currentTime;
      var a = P.findCue(cues, t);
      var f = P.floorCue(cues, t);
      if (dir < 0) seekTo(Math.max(0, a !== -1 ? a - 1 : f));
      else if (dir > 0) seekTo(f + 1);
      else seekTo(Math.max(0, a !== -1 ? a : f), true);
    }

    // ------------------------------------------------------------ word lookup
    function relRect(el) {
      var r = el.getBoundingClientRect(), rr = root.getBoundingClientRect();
      return { left: r.left - rr.left, right: r.right - rr.left, top: r.top - rr.top, bottom: r.bottom - rr.top };
    }

    function openLookup(cueIdx, a, b, lineEl, fromSide) {
      if (cueIdx < 0 || cueIdx >= cues.length || !lineEl) return false;
      var toks = tokensOf(cueIdx);
      var lo = Math.min(a, b), hi = Math.max(a, b);
      if (!toks[lo] || !toks[hi]) return false;
      var c = cues[cueIdx];
      if (!c || !c.src) return false;
      var text = c.src.slice(toks[lo].start, toks[hi].end);
      if (!String(text || "").trim()) return false;
      // Always pause for word study (sites may auto-resume — onPlay holds it while the card is open)
      pauseForStudy();
      var first = lineEl.querySelector('.w[data-i="' + lo + '"]');
      var anchor;
      if (fromSide) {
        var sr = relRect(shadow.querySelector(".side"));
        var wr = relRect(first || lineEl);
        anchor = { left: sr.left, right: sr.left, top: wr.top, bottom: wr.bottom };
      } else {
        var last = lineEl.querySelector('.w[data-i="' + hi + '"]');
        var r1 = relRect(first || lineEl), r2 = relRect(last || lineEl), sb = relRect(subs);
        anchor = { left: Math.min(r1.left, r2.left), right: Math.max(r1.right, r2.right), top: sb.top, bottom: sb.bottom };
      }
      var learn =
        P.baseLang(meta.learnLang) ||
        (DC.settings.learnLang === "auto" ? "fr" : P.baseLang(DC.settings.learnLang)) ||
        "fr";
      var native =
        P.baseLang(meta.nativeLang) || P.baseLang(DC.settings.nativeLang) || "en";
      // Never look up / pronounce learning words as English when dual EN is loaded
      if (P.sameLang(learn, native) && P.baseLang(meta.learnLang)) learn = P.baseLang(meta.learnLang);
      if (!learn || learn === "und") learn = "fr";
      var ok = DC.card.open({
        layer: layer,
        text: text,
        isWord: lo === hi,
        context: c.src,
        contextNative: c.nat,
        lang: learn,
        native: native,
        place: { root: root, anchor: anchor, mode: fromSide ? "left" : "above" },
        meta: { site: adapter.site, title: adapter.title(), url: adapter.link(0), time: Math.floor(c.start) },
        onClose: onCardClose
      });
      if (ok) markSel(lineEl, lo, hi);
      else studyPaused = false;
      return !!ok;
    }

    function markSel(lineEl, lo, hi) {
      clearSel();
      if (!lineEl) return;
      lineEl.querySelectorAll(".w").forEach(function (w) {
        var i = Number(w.getAttribute("data-i"));
        if (i >= lo && i <= hi) w.classList.add("sel");
      });
    }
    function clearSel() {
      shadow.querySelectorAll(".w.sel").forEach(function (w) { w.classList.remove("sel"); });
    }

    function onCardClose() {
      clearSel();
      studyPaused = false;
      if (hoverPaused && overSubs) {
        // Still hovering subtitles — keep paused
        pauseForStudy();
        studyPaused = false;
        hoverPaused = true;
      } else if (hoverPaused) {
        hoverPaused = false;
        try {
          adapter.play();
        } catch (_) {
          /* ignore */
        }
      }
      var v = getVideo();
      if (v) renderCue(P.findCue(cues, v.currentTime));
    }

    function lineOf(el) {
      return el && el.closest ? el.closest("[data-cue]") : null;
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var t = e.target;
      if (t && t.nodeType === 3) t = t.parentElement;
      if (DC.card.contains(t)) return;
      var resizeHandle = t.closest && t.closest("[data-act='side-resize']");
      if (resizeHandle) {
        e.preventDefault();
        e.stopPropagation();
        var hostW = (host.parentElement && host.parentElement.clientWidth) || window.innerWidth || 800;
        resizeDrag = { startX: e.clientX, startW: sideWidth, hostW: hostW };
        root.classList.add("resizing");
        return;
      }
      var w = t.closest && t.closest(".w");
      if (w) {
        e.preventDefault();
        e.stopPropagation();
        pauseForStudy();
        var line = lineOf(w);
        if (!line) return;
        drag = {
          line: line,
          cue: Number(line.getAttribute("data-cue")),
          a: Number(w.getAttribute("data-i")),
          side: !!w.closest(".side")
        };
        drag.b = drag.a;
        markSel(drag.line, drag.a, drag.b);
        return;
      }
      if (DC.card.isOpen()) DC.card.close();
    }

    function onMouseMove(e) {
      if (!drag) return;
      var t = e.target;
      if (t && t.nodeType === 3) t = t.parentElement;
      var w = t && t.closest && t.closest(".w");
      if (!w || !drag.line.contains(w)) return;
      var i = Number(w.getAttribute("data-i"));
      if (i !== drag.b) {
        drag.b = i;
        markSel(drag.line, drag.a, drag.b);
      }
    }

    function finishDrag(e) {
      if (resizeDrag) return;
      if (!drag) return;
      if (e && e.button != null && e.button !== 0) return;
      var d = drag;
      drag = null;
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 50);
      openLookup(d.cue, d.a, d.b, d.line, d.side);
    }

    function onClick(e) {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var t = e.target;
      if (t && t.nodeType === 3) t = t.parentElement;
      if (DC.card.contains(t)) return;
      // Word click fallback (touch / sites that drop mouseup pairing)
      var w = t.closest && t.closest(".w");
      if (w) {
        e.preventDefault();
        e.stopPropagation();
        var line = lineOf(w);
        if (line) {
          var wi = Number(w.getAttribute("data-i"));
          openLookup(Number(line.getAttribute("data-cue")), wi, wi, line, !!w.closest(".side"));
        }
        return;
      }
      var tabBtn = t.closest && t.closest(".stab[data-tab]");
      if (tabBtn) {
        setSideTab(tabBtn.getAttribute("data-tab"));
        return;
      }
      var osAct = t.closest && t.closest("[data-os]");
      if (osAct) {
        var act = osAct.getAttribute("data-os");
        if (act === "toggle") setOsToolsOpen(cues.length ? !osToolsOpen : true);
        else if (act === "search") {
          setOsToolsOpen(true);
          osSearch();
        } else if (act === "best") osLoadBest();
        else if (act === "files") {
          setOsToolsOpen(true);
          osLoadLocalFiles();
        } else if (act === "add-native") osAddNative();
        else if (act === "mt") osMachineTranslate();
        return;
      }
      var osHit = t.closest && t.closest("[data-os-file]");
      if (osHit) {
        osLoadFile(osHit.getAttribute("data-os-file"), osHit.getAttribute("data-os-lang"));
        return;
      }
      var jump = t.closest && t.closest("[data-jump-time]");
      if (jump) {
        var sec = Number(jump.getAttribute("data-jump-time"));
        if (isFinite(sec)) {
          try {
            adapter.seek(sec);
            adapter.play();
          } catch (_) {
            /* ignore */
          }
          setSideTab("script");
        }
        return;
      }
      var actEl = t.closest && t.closest("[data-act]");
      if (actEl) {
        var name = actEl.getAttribute("data-act");
        if (name === "side-resize") return;
        if (name === "side" || name === "side-close") {
          toggleSetting("showSidebar", "Script panel");
        }
        return;
      }
      // Row seek only when not clicking a word
      var row = t.closest && t.closest(".row");
      if (row) seekTo(Number(row.getAttribute("data-cue")));
    }

    function onResizeMove(e) {
      if (!resizeDrag) return;
      var delta = resizeDrag.startX - e.clientX;
      applySideWidth(resizeDrag.startW + delta, false);
    }
    function onResizeUp() {
      if (!resizeDrag) return;
      resizeDrag = null;
      root.classList.remove("resizing");
      applySideWidth(sideWidth, true);
    }

    shadow.addEventListener("mousedown", onMouseDown);
    shadow.addEventListener("mousemove", onMouseMove);
    shadow.addEventListener("mouseup", function (e) { if (e.button === 0) finishDrag(); });
    window.addEventListener("mousemove", onResizeMove, true);
    window.addEventListener("mouseup", onResizeUp, true);
    window.addEventListener("mouseup", finishDrag, true);
    shadow.addEventListener("click", onClick);
    list.addEventListener("wheel", function () { lastUserScroll = Date.now(); }, { passive: true });
    list.addEventListener("pointerdown", function () { lastUserScroll = Date.now(); });
    if (vocabList) {
      vocabList.addEventListener("wheel", function () { lastUserScroll = Date.now(); }, { passive: true });
    }
    if (osQ) {
      osQ.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          osSearch();
        }
      });
    }
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === "local" && changes.vocab && sideTab === "vocab" && root.classList.contains("side-open")) {
          buildVocab();
        }
      });
    } catch (_) {
      /* ignore */
    }

    function onSubsEnter() {
      overSubs = true;
      if (!active()) return;
      // Hover-pause defaults on; still pause when the setting is missing/undefined
      if (DC.settings.hoverPause === false) return;
      var v = getVideo();
      if (v && !v.paused) {
        hoverPaused = true;
        pauseForStudy();
        studyPaused = false; // hover-only — allow resume on leave
        hoverPaused = true;
      }
    }
    function onSubsLeave() {
      overSubs = false;
      if (drag || DC.card.isOpen()) return;
      if (hoverPaused) {
        hoverPaused = false;
        studyPaused = false;
        try {
          adapter.play();
        } catch (_) {
          /* ignore */
        }
      }
    }
    subs.addEventListener("mouseenter", onSubsEnter);
    subs.addEventListener("mouseleave", onSubsLeave);
    subs.addEventListener("pointerenter", onSubsEnter);
    subs.addEventListener("pointerleave", onSubsLeave);

    function onDocDown(e) {
      if (!DC.card.isOpen()) return;
      if (e.composedPath && e.composedPath().indexOf(host) !== -1) return;
      DC.card.close();
    }
    document.addEventListener("mousedown", onDocDown, true);

    // ------------------------------------------------------------ keyboard
    function isEditable(e) {
      var path = e.composedPath ? e.composedPath() : [e.target];
      for (var i = 0; i < path.length; i++) {
        var el = path[i];
        if (!el || el.nodeType !== 1) continue;
        var tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
      }
      return false;
    }

    function toggleSetting(key, label) {
      var patch = {};
      patch[key] = !DC.settings[key];
      DC.saveSettings(patch);
      applySettings();
      if (label) toast(label + (patch[key] ? ": on" : ": off"), 1500);
    }

    function handleKey(e) {
      if (destroyed || !DC.settings.enabled) return false;
      if (e.ctrlKey || e.metaKey) return false;
      if (isEditable(e)) return false;
      var code = e.code;
      var hasCues = cues.length > 0;
      var shellOn = hasCues || idleShell;
      if (!shellOn && code !== "KeyT" && code !== "Escape") return false;
      if (e.altKey) {
        if (!hasCues) return false;
        if (code !== "KeyS" || e.shiftKey) return false;
        hiddenByUser = !hiddenByUser;
        syncVisibility();
        if (hiddenByUser && adapter.showNative) adapter.showNative();
        toast(hiddenByUser ? DC.brand + " subtitles hidden (Alt+S to show)" : DC.brand + " subtitles shown", 1800);
        return true;
      }
      if (e.shiftKey || hiddenByUser) return false;
      // Show/hide Script panel even before cues load (movie sites / OpenSubtitles shell)
      if (code === "KeyT") {
        toggleSetting("showSidebar", "Script panel");
        return true;
      }
      if (code === "Escape") {
        if (DC.card.isOpen()) {
          DC.card.close();
          return true;
        }
        if (DC.settings.showSidebar) {
          toggleSetting("showSidebar", "Script panel");
          return true;
        }
        return false;
      }
      if (!hasCues) return false;
      switch (code) {
        case "KeyA": nav(-1); return true;
        case "KeyS": nav(0); return true;
        case "KeyD": nav(1); return true;
        case "KeyQ": autoPausedFor = -1; toggleSetting("autoPause", "Auto-pause"); return true;
        case "KeyE": toggleSetting("blurNative", "Blur translation"); return true;
      }
      return false;
    }

    function onKeyDown(e) {
      if (handleKey(e)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);

    // ------------------------------------------------------------ public
    var ctl = {
      setCues: function (list_, meta_) {
        if (destroyed) return;
        putCues(list_, meta_);
      },
      showShell: function (note) {
        if (destroyed) return;
        idleShell = true;
        if (note) meta = Object.assign({}, meta, { note: note, label: meta.label || "Waiting for subtitles" });
        ensureMounted();
        buildSidebar();
        applySettings();
        syncVisibility();
        startLoop();
      },
      clear: function () {
        cues = [];
        meta = {};
        tokensCache = [];
        curIdx = -2;
        curWord = -2;
        idleShell = false;
        subs.hidden = true;
        list.innerHTML = "";
        if (DC.card.isOpen()) DC.card.close();
        syncVisibility();
      },
      toast: function (msg, ms) {
        toast(msg, ms);
        startLoop();
      },
      applySettings: function () { applySettings(); },
      hasCues: function () { return cues.length > 0; },
      cueCount: function () { return cues.length; },
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(raf);
        clearInterval(watchdog);
        clearTimeout(toastTimer);
        if (ro) ro.disconnect();
        if (DC.card.isOpen()) DC.card.close();
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("mouseup", finishDrag, true);
        document.removeEventListener("mousedown", onDocDown, true);
        if (video) {
          video.removeEventListener("play", onPlay);
          video.removeEventListener("seeking", onSeeking);
        }
        setNative(false);
        host.remove();
      },
      // Test/debug hook: read-only snapshot.
      snapshot: function () {
        var v = getVideo();
        var t = v ? v.currentTime : 0;
        var f = P.floorCue(cues, t);
        var words = [].map.call(l1Box.querySelectorAll(".w"), function (w) {
          var r = w.getBoundingClientRect();
          return { text: w.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        return {
          cues: cues.length, curIdx: curIdx, meta: meta, hidden: hiddenByUser, side: root.classList.contains("side-open"),
          cardOpen: DC.card.isOpen(), cardText: layer.textContent.slice(0, 300), t: t, floor: f,
          cur: f >= 0 ? cues[f] : null, next: f + 1 < cues.length ? cues[f + 1] : null,
          subsShown: !subs.hidden, l1: l1Box.textContent, l2: l2Line.hidden ? "" : l2Box.textContent, chip: chip.hidden ? "" : chip.textContent,
          note: ntLine.hidden ? "" : note.textContent, toast: lastToast, words: words, card: DC.card.debug()
        };
      }
    };
    try {
      chrome.storage.local.get("dcSideWidth", function (got) {
        var w = got && Number(got.dcSideWidth);
        if (w && isFinite(w)) sideWidth = w;
        applySideWidth(sideWidth, false);
      });
    } catch (_) {
      /* ignore */
    }
    ensureMounted();
    applySettings();
    return ctl;
  };
})();
