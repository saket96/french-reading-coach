// Generic adapter for open / indie video sites: HTML5 TextTracks, <track src>,
// linked .vtt/.srt files, and common players (Video.js, Plyr, MediaElement).
(function () {
  "use strict";
  var DC = window.DC;
  var P = DC.P;
  var HIDE_CSS_ID = "dc-hide-html5-captions";

  var LANG_HINT =
    /\b(af|ar|bg|bn|ca|cs|da|de|el|en|es|et|eu|fa|fi|fr|gl|he|hi|hr|hu|hy|id|is|it|ja|ka|kk|ko|lt|lv|mk|ms|nl|no|pl|pt|ro|ru|sk|sl|sq|sr|sv|sw|ta|te|th|tr|uk|ur|vi|zh|yue|cmn|fra|fre|deu|ger|spa|ita|por|jpn|kor|chi|eng|und)\b/i;

  function stripTags(html) {
    return String(html || "")
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pickMainVideo() {
    var list = Array.prototype.slice.call(document.querySelectorAll("video"));
    if (!list.length) return null;
    list.sort(function (a, b) {
      var ap = a.paused ? 0 : 1;
      var bp = b.paused ? 0 : 1;
      if (ap !== bp) return bp - ap;
      var ar = (a.clientWidth || 0) * (a.clientHeight || 0);
      var br = (b.clientWidth || 0) * (b.clientHeight || 0);
      return br - ar;
    });
    return list[0];
  }

  function guessLang() {
    for (var i = 0; i < arguments.length; i++) {
      var s = String(arguments[i] || "").toLowerCase();
      if (!s) continue;
      var m = s.match(
        /(?:^|[._/\-\s\[\(])([a-z]{2,3})(?:[._/\-\s\]\)]|$)/g
      );
      if (m) {
        for (var j = m.length - 1; j >= 0; j--) {
          var code = m[j].replace(/[^a-z]/g, "");
          if (!code || code === "vtt" || code === "srt" || code === "ass") continue;
          var map = { fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es", ita: "it", por: "pt", jpn: "ja", kor: "ko", chi: "zh", eng: "en" };
          code = map[code] || code;
          if (LANG_HINT.test(code) && code.length <= 3) return P.baseLang(code) || code;
        }
      }
      var direct = LANG_HINT.exec(s);
      if (direct) {
        var c = direct[1].toLowerCase();
        var map2 = { fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es", ita: "it", por: "pt", jpn: "ja", kor: "ko", chi: "zh", eng: "en" };
        return P.baseLang(map2[c] || c) || c;
      }
    }
    return "";
  }

  function absUrl(href, base) {
    try {
      return new URL(href, base || location.href).href;
    } catch (_) {
      return "";
    }
  }

  function isSubUrl(url) {
    return /\.(vtt|srt)(?:$|[?#])/i.test(url || "");
  }

  // Unified track descriptor used by pick/load.
  // { id, language, label, kind, getCues: async () => cues[] }
  function fromTextTrack(tt, srcHint) {
    return {
      id: "tt:" + (tt.language || "") + ":" + (tt.label || "") + ":" + (srcHint || ""),
      language: tt.language || guessLang(tt.label, srcHint) || "",
      label: tt.label || tt.language || "Track",
      kind: tt.kind || "subtitles",
      getCues: async function () {
        try {
          if (tt.mode === "disabled") tt.mode = "hidden";
        } catch (_) {
          /* ignore */
        }
        var list = tt.cues;
        if (list && list.length) {
          var out = [];
          for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c) continue;
            var text = stripTags(c.text);
            if (!text) continue;
            out.push({ start: c.startTime, end: c.endTime, text: text });
          }
          if (out.length) return out;
        }
        if (srcHint) return fetchParsed(srcHint);
        return waitTextTrackCues(tt, 2800);
      }
    };
  }

  function fromUrl(url, label, language) {
    return {
      id: "url:" + url,
      language: language || guessLang(url, label) || "",
      label: label || url.split("/").pop() || "Subtitles",
      kind: "subtitles",
      getCues: function () {
        return fetchParsed(url);
      }
    };
  }

  function waitTextTrackCues(track, ms) {
    return new Promise(function (resolve) {
      function read() {
        var list = track.cues;
        if (!list || !list.length) return [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (!c) continue;
          var text = stripTags(c.text);
          if (text) out.push({ start: c.startTime, end: c.endTime, text: text });
        }
        return out;
      }
      var existing = read();
      if (existing.length) return resolve(existing);
      var done = false;
      var timer = setTimeout(finish, ms || 2500);
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          track.removeEventListener("cuechange", onCue);
        } catch (_) {
          /* ignore */
        }
        resolve(read());
      }
      function onCue() {
        if (read().length) finish();
      }
      try {
        track.addEventListener("cuechange", onCue);
      } catch (_) {
        /* ignore */
      }
      try {
        if (track.mode === "disabled") track.mode = "hidden";
      } catch (_) {
        /* ignore */
      }
    });
  }

  async function fetchParsed(url) {
    if (!url || /^(data|blob|javascript):/i.test(url)) return [];
    // Service-worker fetch bypasses the page CSP connect-src (Opera/Chrome on locked-down sites).
    try {
      var via = await DC.send({ type: "fetchText", url: url, credentials: "omit" });
      if (via && via.ok && via.text) return P.parseSubtitleText(via.text, url);
      if (via && via.status === 403) {
        via = await DC.send({ type: "fetchText", url: url, credentials: "include" });
        if (via && via.ok && via.text) return P.parseSubtitleText(via.text, url);
      }
    } catch (_) {
      /* fall through */
    }
    try {
      if (DC.page && DC.page.request) {
        var page = await DC.page.request("GEN_FETCH", { url: url }, 8000);
        if (page && page.status >= 200 && page.status < 300 && page.text) {
          return P.parseSubtitleText(page.text, url);
        }
      }
    } catch (_) {
      /* fall through */
    }
    try {
      var res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      var text = await res.text();
      return P.parseSubtitleText(text, url);
    } catch (_) {
      return [];
    }
  }

  function collectTracks(video) {
    var seen = Object.create(null);
    var out = [];
    function add(desc) {
      if (!desc || !desc.id || seen[desc.id]) return;
      seen[desc.id] = true;
      out.push(desc);
    }

    // 1) Live TextTrack list
    if (video && video.textTracks) {
      for (var i = 0; i < video.textTracks.length; i++) {
        var t = video.textTracks[i];
        if (!t) continue;
        var kind = String(t.kind || "").toLowerCase();
        if (kind && kind !== "subtitles" && kind !== "captions") continue;
        add(fromTextTrack(t));
      }
    }

    // 2) <track src> under the video (and nearby players)
    var roots = [];
    if (video) {
      roots.push(video);
      if (video.parentElement) roots.push(video.parentElement);
      var player = video.closest(
        ".video-js, .plyr, .mejs__container, .jwplayer, .html5-video-player, [data-player], .vjs-tech, mediaelementwrapper"
      );
      if (player) roots.push(player);
    }
    roots.push(document);

    roots.forEach(function (root) {
      if (!root || !root.querySelectorAll) return;
      var nodes = root.querySelectorAll(
        "track[src], a[href], source[src], [data-src], [data-track-src], [data-subtitle], [data-subtitles], [data-captions]"
      );
      for (var n = 0; n < nodes.length; n++) {
        var el = nodes[n];
        var href =
          el.getAttribute("src") ||
          el.getAttribute("href") ||
          el.getAttribute("data-src") ||
          el.getAttribute("data-track-src") ||
          el.getAttribute("data-subtitle") ||
          el.getAttribute("data-subtitles") ||
          el.getAttribute("data-captions") ||
          "";
        if (!href || !isSubUrl(href)) continue;
        var url = absUrl(href);
        if (!url) continue;
        var label =
          el.getAttribute("label") ||
          el.getAttribute("srclang") ||
          el.textContent ||
          "";
        var lang =
          el.getAttribute("srclang") ||
          el.getAttribute("hreflang") ||
          guessLang(url, label);
        add(fromUrl(url, stripTags(label).slice(0, 80), lang));
      }
    });

    return out;
  }

  function basenameProbes(video, learnLang, nativeLang) {
    var src = video && (video.currentSrc || video.src);
    if (!src) return [];
    var base = src.replace(/\.[a-z0-9]{2,5}(?:$|[?#])/i, "");
    var langs = [];
    function pushLang(code) {
      var c = P.baseLang(code);
      if (c && langs.indexOf(c) === -1) langs.push(c);
    }
    pushLang(learnLang);
    pushLang(nativeLang);
    ["en", "fr", "es", "de", "it", "pt", "ja", "ko", "zh"].forEach(pushLang);
    var out = [];
    var seen = Object.create(null);
    function add(url, label, language) {
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push(fromUrl(url, label, language));
    }
    add(base + ".vtt", "default", learnLang || "");
    add(base + ".srt", "default", learnLang || "");
    langs.forEach(function (lang) {
      add(base + "." + lang + ".vtt", lang, lang);
      add(base + "." + lang + ".srt", lang, lang);
      add(base + "_" + lang + ".vtt", lang, lang);
      add(base + "_" + lang + ".srt", lang, lang);
      add(base + "-" + lang + ".vtt", lang, lang);
      add(base + "-" + lang + ".srt", lang, lang);
    });
    return out;
  }

  function pickTracks(tracks, learnWant, nativeWant) {
    function matchLang(tr, lang) {
      if (!lang || lang === "auto") return false;
      return P.sameLang(tr.language, lang);
    }
    var learn = null;
    var nat = null;
    if (learnWant && learnWant !== "auto") {
      for (var i = 0; i < tracks.length; i++) {
        if (matchLang(tracks[i], learnWant)) {
          learn = tracks[i];
          break;
        }
      }
    }
    if (!learn && tracks.length) learn = tracks[0];
    if (nativeWant) {
      for (var j = 0; j < tracks.length; j++) {
        if (tracks[j] !== learn && matchLang(tracks[j], nativeWant)) {
          nat = tracks[j];
          break;
        }
      }
      // second track with a different language if native not found by code
      if (!nat) {
        for (var k = 0; k < tracks.length; k++) {
          if (tracks[k] === learn) continue;
          if (!tracks[k].language || !P.sameLang(tracks[k].language, learn.language)) {
            nat = tracks[k];
            break;
          }
        }
      }
    }
    return { learn: learn, native: nat };
  }

  DC.generic = function () {
    var ctl = null;
    var token = 0;
    var currentKey = "";
    var diag = (DC.diag = { site: "generic" });
    var videoEl = null;
    var poll = 0;
    var boundVideo = null;
    var lastToastAt = 0;
    var netTracks = []; // subtitle URLs captured by MAIN-world hook
    var loadedKey = "";

    function mergeNetTrack(item) {
      if (!item || !item.url) return false;
      for (var i = 0; i < netTracks.length; i++) {
        if (netTracks[i].url === item.url) return false;
      }
      netTracks.push(item);
      return true;
    }

    async function refreshNetTracks() {
      try {
        var list = await DC.page.request("GEN_LIST_SUBS", {}, 1500);
        if (Array.isArray(list)) {
          for (var i = 0; i < list.length; i++) mergeNetTrack(list[i]);
        }
      } catch (_) {
        /* hook may be absent on some frames */
      }
    }

    function netAsTracks() {
      return netTracks.map(function (t) {
        return fromUrl(t.url, t.label || "", t.language || "");
      });
    }

    DC.page.on("GEN_SUB", function (msg) {
      if (mergeNetTrack(msg.track)) {
        if (DC.running) {
          token++;
          currentKey = "";
          load(token);
        }
      }
    });

    function floatingRoot() {
      var root = document.getElementById("dc-floating-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "dc-floating-root";
        root.setAttribute(
          "style",
          "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;"
        );
        (document.body || document.documentElement).appendChild(root);
      }
      return root;
    }

    var adapter = {
      site: "generic",
      bottom: "8%",
      sideBottom: "0px",
      container: function () {
        var v = adapter.video();
        if (!v) return floatingRoot();
        var wrap = v.closest(
          ".video-js, .plyr, .mejs__container, .jwplayer, .html5-video-player, [data-player], .vjs-tech"
        );
        if (wrap) return wrap;
        var p = v.parentElement;
        while (p && p !== document.body) {
          var style = window.getComputedStyle(p);
          if (style.position === "relative" || style.position === "absolute" || style.position === "fixed") {
            return p;
          }
          p = p.parentElement;
        }
        return v.parentElement || floatingRoot();
      },
      video: function () {
        if (videoEl && videoEl.isConnected) return videoEl;
        videoEl = pickMainVideo();
        return videoEl;
      },
      seek: function (sec) {
        var v = adapter.video();
        if (v) v.currentTime = Math.max(0, sec);
      },
      pause: function () {
        var v = adapter.video();
        if (v && !v.paused) v.pause();
      },
      play: function () {
        var v = adapter.video();
        if (v && v.paused) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        }
      },
      hideNative: function (hide) {
        var el = document.getElementById(HIDE_CSS_ID);
        if (hide) {
          if (!el) {
            el = document.createElement("style");
            el.id = HIDE_CSS_ID;
            el.textContent = [
              "video::cue{visibility:hidden !important}",
              "video::-webkit-media-text-track-display{display:none !important}",
              ".vjs-text-track-display,.plyr__captions,.mejs-captions-layer,",
              ".mejs__captions-layer,.jw-captions,.caption-window,",
              "[class*='subtitle-overlay'],[class*='captions-text']{display:none !important}"
            ].join("");
            (document.head || document.documentElement).appendChild(el);
          }
          var v = adapter.video();
          if (v && v.textTracks) {
            for (var i = 0; i < v.textTracks.length; i++) {
              try {
                if (v.textTracks[i].mode === "showing") v.textTracks[i].mode = "hidden";
              } catch (_) {
                /* ignore */
              }
            }
          }
        } else if (el) {
          el.remove();
        }
      },
      showNative: function () {},
      title: function () {
        return document.title || location.hostname;
      },
      link: function (sec) {
        try {
          var u = new URL(location.href);
          if (sec) u.hash = "t=" + Math.floor(sec);
          return u.toString();
        } catch (_) {
          return location.href;
        }
      }
    };

    function ensureCtl() {
      if (!ctl) ctl = DC.createOverlay(adapter);
      return ctl;
    }

    function stale(t) {
      return t !== token || !DC.running;
    }

    function softToast(msg, ms) {
      var now = Date.now();
      if (now - lastToastAt < 4000) return;
      lastToastAt = now;
      ensureCtl().toast(msg, ms || 4000);
    }

    function videoKey(v) {
      if (!v) return "";
      var tracks = collectTracks(v);
      return [
        v.currentSrc || v.src || "",
        Math.round(v.duration || 0),
        tracks.length,
        netTracks.length,
        tracks
          .map(function (t) {
            return t.id;
          })
          .join(",")
      ].join("|");
    }

    async function loadCues(desc) {
      if (!desc) return [];
      try {
        var cues = await desc.getCues();
        return Array.isArray(cues) ? cues : [];
      } catch (_) {
        return [];
      }
    }

    async function load(t) {
      var v = adapter.video();
      if (!v) {
        diag.label = "";
        diag.note = "No HTML5 video in this frame";
        return;
      }
      bindVideo(v);
      await refreshNetTracks();
      if (stale(t)) return;

      var s = DC.settings;
      var tracks = collectTracks(v).concat(netAsTracks());
      diag.tracks = tracks.map(function (tr) {
        return { id: tr.id, lang: tr.language, label: tr.label, kind: tr.kind };
      });
      diag.net = netTracks.length;

      // Show shell immediately so movie-site iframes feel alive while CC loads
      var waitMsg =
        tracks.length || netTracks.length
          ? "Looking for subtitles…"
          : "Turn on Audio & Subtitles (CC) in the player — DualCoach will catch them";
      ensureCtl().showShell(waitMsg);
      softToast(waitMsg, 4000);

      var pick = pickTracks(tracks, s.learnLang, s.nativeLang);
      var learnCues = pick.learn ? await loadCues(pick.learn) : [];
      if (stale(t)) return;

      if (!learnCues.length) {
        for (var i = 0; i < tracks.length && !learnCues.length; i++) {
          if (pick.learn && tracks[i] === pick.learn) continue;
          learnCues = await loadCues(tracks[i]);
          if (stale(t)) return;
          if (learnCues.length) {
            pick.learn = tracks[i];
            break;
          }
        }
      }

      // Archive.org / static hosts: try movie.vtt / movie.fr.srt next to the video file
      if (!learnCues.length) {
        var probes = basenameProbes(v, s.learnLang, s.nativeLang);
        diag.probes = probes.length;
        for (var p = 0; p < probes.length && !learnCues.length; p++) {
          learnCues = await loadCues(probes[p]);
          if (stale(t)) return;
          if (learnCues.length) {
            pick.learn = probes[p];
            tracks = tracks.concat(probes);
            break;
          }
        }
      }

      if (!learnCues.length) {
        diag.label = "";
        diag.note = "Waiting for subtitle files (enable CC in the player)";
        return;
      }

      if (!pick.native || pick.native === pick.learn) {
        pick = pickTracks(tracks, s.learnLang, s.nativeLang);
      }

      var natCues = [];
      if (pick.native && pick.native !== pick.learn) {
        natCues = await loadCues(pick.native);
        if (stale(t)) return;
      }
      if (!natCues.length && s.nativeLang) {
        var more = basenameProbes(v, s.learnLang, s.nativeLang).concat(netAsTracks());
        for (var q = 0; q < more.length && !natCues.length; q++) {
          if (pick.learn && more[q].id === pick.learn.id) continue;
          if (more[q].language && !P.sameLang(more[q].language, s.nativeLang)) continue;
          natCues = await loadCues(more[q]);
          if (stale(t)) return;
          if (natCues.length) pick.native = more[q];
        }
      }

      var key =
        (pick.learn && pick.learn.id) +
        "|" +
        (pick.native && pick.native.id) +
        "|" +
        learnCues.length +
        "|" +
        natCues.length;
      if (key === loadedKey && ctl && ctl.hasCues()) return;
      loadedKey = key;

      var learnLang = P.baseLang(pick.learn.language) || s.learnLang || "und";
      var nativeLang = pick.native ? P.baseLang(pick.native.language) || s.nativeLang : s.nativeLang;
      var learnName = DC.langName(learnLang) || learnLang;
      var nativeName = DC.langName(nativeLang) || nativeLang;

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

      var label = natCues.length ? learnName + " + " + nativeName : learnName + " only";
      diag.label = label;
      diag.learnCues = learnCues.length;
      diag.nativeCues = natCues.length;
      diag.note = natCues.length ? "" : "Only one subtitle language found on this page";
      var c = ensureCtl();
      c.setCues(aligned, {
        learnLang: learnLang,
        nativeLang: nativeLang,
        nativeKind: natCues.length ? "official" : "",
        label: label,
        note: diag.note
      });
      softToast(natCues.length ? "Loaded " + label : "Showing " + learnName + " only", 3500);
    }

    function bindVideo(v) {
      if (boundVideo === v) return;
      if (boundVideo) {
        try {
          boundVideo.textTracks.removeEventListener("addtrack", onTracksChanged);
        } catch (_) {
          /* ignore */
        }
      }
      boundVideo = v;
      try {
        v.textTracks.addEventListener("addtrack", onTracksChanged);
      } catch (_) {
        /* ignore */
      }
    }

    function onTracksChanged() {
      if (!DC.running) return;
      token++;
      currentKey = "";
      load(token);
    }

    function tick() {
      if (!DC.running) return;
      var v = adapter.video();
      var key = videoKey(v);
      if (key && key !== currentKey) {
        currentKey = key;
        token++;
        load(token);
      }
    }

    return {
      start: function () {
        token++;
        currentKey = "";
        loadedKey = "";
        refreshNetTracks().then(function () {
          tick();
        });
        if (!poll) poll = setInterval(tick, 1200);
      },
      stop: function () {
        token++;
        currentKey = "";
        loadedKey = "";
        if (poll) {
          clearInterval(poll);
          poll = 0;
        }
        if (ctl) {
          ctl.destroy();
          ctl = null;
        }
        var hide = document.getElementById(HIDE_CSS_ID);
        if (hide) hide.remove();
      },
      applySettings: function (prev) {
        if (ctl) ctl.applySettings();
        var s = DC.settings;
        if (prev && (prev.learnLang !== s.learnLang || prev.nativeLang !== s.nativeLang)) {
          token++;
          currentKey = "";
          load(token);
        }
      },
      ctl: function () {
        return ctl;
      }
    };
  };
})();
