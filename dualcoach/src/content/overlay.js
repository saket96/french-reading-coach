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
    host.setAttribute("style", "all:initial;position:absolute;inset:0;pointer-events:none;z-index:60;");
    var shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      "<style>" + DC.CSS + "</style>" +
      '<div class="root off">' +
      '<div class="stage">' +
      '<div class="subs" hidden><div class="line l1"><span class="box"></span></div>' +
      '<div class="line l2"><span class="box"></span><span class="chip" hidden></span></div>' +
      '<div class="line nt"><span class="note"></span></div></div>' +
      '<div class="tools"><button class="tb" data-act="side" type="button" title="Script panel (T)">' + DC.SVG.list + "<span>Script</span></button></div>" +
      '<div class="toast" role="status"></div>' +
      "</div>" +
      '<aside class="side">' +
      '<div class="side-hd"><div class="side-brand"><div class="side-t">DualCoach</div><div class="side-sub"></div></div>' +
      '<button class="x" data-act="side-close" type="button" title="Close (T)">' + DC.SVG.close + "</button></div>" +
      '<div class="side-tabs">' +
      '<button class="stab on" data-tab="script" type="button">Script</button>' +
      '<button class="stab" data-tab="vocab" type="button">Vocab</button>' +
      "</div>" +
      '<div class="side-panes">' +
      '<div class="pane on" data-pane="script">' +
      '<div class="os-box">' +
      '<div class="os-hd">Add subtitles</div>' +
      '<p class="os-help">Site has no CC? Search OpenSubtitles, or load .srt / .vtt files from your computer.</p>' +
      '<input class="os-q" type="search" placeholder="Movie or series title (e.g. Rebel Moon S01E01)" spellcheck="false" />' +
      '<div class="os-actions">' +
      '<button class="os-btn" data-os="search" type="button">Search</button>' +
      '<button class="os-btn os-btn-primary" data-os="best" type="button">Load best dual</button>' +
      "</div>" +
      '<div class="os-files">' +
      '<label class="os-file">Learning .srt/.vtt<input type="file" class="os-file-learn" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" /></label>' +
      '<label class="os-file">Translation .srt/.vtt<input type="file" class="os-file-native" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" /></label>' +
      '<button class="os-btn" data-os="files" type="button">Load files</button>' +
      "</div>" +
      '<div class="os-status" hidden></div>' +
      '<div class="os-results"></div>' +
      "</div>" +
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
    var osQ = $(".os-q");
    var osStatus = $(".os-status");
    var osResults = $(".os-results");
    var osFileLearn = $(".os-file-learn");
    var osFileNative = $(".os-file-native");
    var layer = $(".layer");
    var sideTab = "script";
    var osHits = [];
    var pendingLearnFile = "";
    var pendingNativeFile = "";

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
    var overSubs = false, hoverPaused = false;
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

    function onPlay() {
      if (DC.card.isOpen()) DC.card.close();
      hoverPaused = false;
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
      note.textContent = meta.note || "";
      ntLine.hidden = !meta.note;
      subs.hidden = false;
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
      cues = list_ || [];
      meta = meta_ || {};
      idleShell = false;
      tokensCache = [];
      curIdx = -2;
      curWord = -2;
      activeIdx = -1;
      autoPausedFor = -1;
      if (DC.card.isOpen()) DC.card.close();
      ensureMounted();
      buildSidebar();
      applySettings();
      startLoop();
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
      putCues(aligned, {
        learnLang: learnLang || DC.settings.learnLang,
        nativeLang: nativeLang || DC.settings.nativeLang,
        nativeKind: natCues.length ? "opensubtitles" : "",
        label: label || "OpenSubtitles",
        note: natCues.length ? "" : "Translation track not found — showing one language"
      });
      toast("Loaded " + (label || "OpenSubtitles"), 3500);
      setOsStatus("Loaded " + aligned.length + " lines", "ok");
      return true;
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
      var res = await DC.send({
        type: "osLoadBest",
        query: q,
        learnLang: DC.settings.learnLang,
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
      if (res.remaining != null) setOsStatus("Loaded · " + res.remaining + " downloads left today", "ok");
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
      // If user clicked a native-lang file while we already have learn cues, keep learn and add nat
      if (
        cues.length &&
        lang &&
        P.sameLang(lang, nativeLang) &&
        meta.learnLang &&
        !P.sameLang(lang, meta.learnLang)
      ) {
        var learnCues = cues.map(function (c) {
          return { start: c.start, end: c.end, text: c.src };
        });
        var natCues = P.parseSubtitleText(res.text, "os.srt");
        var aligned = P.alignCues(learnCues, natCues, false);
        putCues(aligned, {
          learnLang: meta.learnLang || learnLang,
          nativeLang: nativeLang,
          nativeKind: "opensubtitles",
          label: (meta.label || "Script") + " + OpenSubtitles",
          note: ""
        });
        setOsStatus("Added " + (DC.langName(lang) || lang) + " translation", "ok");
        return;
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
      if (!cues.length) {
        list.innerHTML =
          '<div class="empty">No subtitles yet. Enable CC in the player, or search OpenSubtitles above.</div>';
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

    function applySettings() {
      var s = DC.settings;
      root.classList.toggle("blur-nat", !!s.blurNative);
      root.classList.toggle("blur-learn", !!s.blurLearn);
      root.classList.toggle("side-open", !!s.showSidebar);
      sideBtn.classList.toggle("on", !!s.showSidebar);
      root.style.setProperty("--bottom", adapter.bottom || "10%");
      root.style.setProperty("--side-bottom", adapter.sideBottom || "0px");
      root.style.setProperty("--side-w", "400px");
      applyFont();
      syncVisibility();
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
      var toks = tokensOf(cueIdx);
      var lo = Math.min(a, b), hi = Math.max(a, b);
      var c = cues[cueIdx];
      var text = c.src.slice(toks[lo].start, toks[hi].end);
      var v = getVideo();
      if (v && !v.paused) adapter.pause();
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
      DC.card.open({
        layer: layer,
        text: text,
        isWord: lo === hi,
        context: c.src,
        contextNative: c.nat,
        lang: meta.learnLang,
        native: meta.nativeLang,
        place: { root: root, anchor: anchor, mode: fromSide ? "left" : "above" },
        meta: { site: adapter.site, title: adapter.title(), url: adapter.link(0), time: Math.floor(c.start) },
        onClose: onCardClose
      });
      markSel(lineEl, lo, hi);
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
      if (hoverPaused && !overSubs) {
        hoverPaused = false;
        adapter.play();
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
      if (DC.card.contains(t)) return;
      var w = t.closest && t.closest(".w");
      if (w) {
        var line = lineOf(w);
        if (!line) return;
        drag = { line: line, cue: Number(line.getAttribute("data-cue")), a: Number(w.getAttribute("data-i")), side: !!w.closest(".side") };
        drag.b = drag.a;
        markSel(drag.line, drag.a, drag.b);
        return;
      }
      if (DC.card.isOpen()) DC.card.close();
    }

    function onMouseMove(e) {
      if (!drag) return;
      var w = e.target.closest && e.target.closest(".w");
      if (!w || !drag.line.contains(w)) return;
      var i = Number(w.getAttribute("data-i"));
      if (i !== drag.b) {
        drag.b = i;
        markSel(drag.line, drag.a, drag.b);
      }
    }

    function finishDrag() {
      if (!drag) return;
      var d = drag;
      drag = null;
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      openLookup(d.cue, d.a, d.b, d.line, d.side);
    }

    function onClick(e) {
      if (suppressClick) { suppressClick = false; return; }
      var t = e.target;
      if (DC.card.contains(t)) return;
      var tabBtn = t.closest && t.closest(".stab[data-tab]");
      if (tabBtn) {
        setSideTab(tabBtn.getAttribute("data-tab"));
        return;
      }
      var osAct = t.closest && t.closest("[data-os]");
      if (osAct) {
        var act = osAct.getAttribute("data-os");
        if (act === "search") osSearch();
        else if (act === "best") osLoadBest();
        else if (act === "files") osLoadLocalFiles();
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
      var act = t.closest && t.closest("[data-act]");
      if (act) {
        var name = act.getAttribute("data-act");
        if (name === "side" || name === "side-close") toggleSetting("showSidebar");
        return;
      }
      var row = t.closest && t.closest(".row");
      if (row) seekTo(Number(row.getAttribute("data-cue")));
    }

    shadow.addEventListener("mousedown", onMouseDown);
    shadow.addEventListener("mousemove", onMouseMove);
    shadow.addEventListener("mouseup", function (e) { if (e.button === 0) finishDrag(); });
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

    subs.addEventListener("mouseenter", function () {
      overSubs = true;
      if (!DC.settings.hoverPause || !active()) return;
      var v = getVideo();
      if (v && !v.paused) {
        hoverPaused = true;
        adapter.pause();
      }
    });
    subs.addEventListener("mouseleave", function () {
      overSubs = false;
      if (drag) return;
      if (hoverPaused && !DC.card.isOpen()) {
        hoverPaused = false;
        adapter.play();
      }
    });

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
      if (destroyed || !cues.length || !DC.settings.enabled) return false;
      if (e.ctrlKey || e.metaKey) return false;
      if (isEditable(e)) return false;
      var code = e.code;
      if (e.altKey) {
        if (code !== "KeyS" || e.shiftKey) return false;
        hiddenByUser = !hiddenByUser;
        syncVisibility();
        if (hiddenByUser && adapter.showNative) adapter.showNative();
        toast(hiddenByUser ? DC.brand + " subtitles hidden (Alt+S to show)" : DC.brand + " subtitles shown", 1800);
        return true;
      }
      if (e.shiftKey || hiddenByUser) return false;
      switch (code) {
        case "KeyA": nav(-1); return true;
        case "KeyS": nav(0); return true;
        case "KeyD": nav(1); return true;
        case "KeyQ": autoPausedFor = -1; toggleSetting("autoPause", "Auto-pause"); return true;
        case "KeyE": toggleSetting("blurNative", "Blur translation"); return true;
        case "KeyT": toggleSetting("showSidebar"); return true;
        case "Escape":
          if (DC.card.isOpen()) { DC.card.close(); return true; }
          return false;
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
    ensureMounted();
    applySettings();
    return ctl;
  };
})();
