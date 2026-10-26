// MAIN-world hook. Runs at document_start before the site's own scripts.
// Everything is wrapped: an exception escaping from here can break YouTube/Netflix itself.
(function () {
  "use strict";
  try {
    if (window.__dcHookInstalled) return;
    Object.defineProperty(window, "__dcHookInstalled", { value: true });

    var P = window.DC_PARSERS;
    try { delete window.DC_PARSERS; } catch (_) { /* ignore */ }
    if (!P) return;

    var host = location.hostname;
    var IS_YT = /(^|\.)youtube\.com$/.test(host);
    var IS_NF = /(^|\.)netflix\.com$/.test(host);
    var IS_GENERIC = !IS_YT && !IS_NF;
    var _fetch = window.fetch;
    var handlers = {};

    function post(msg) {
      try {
        msg.__dc = true;
        msg.dir = "toContent";
        window.postMessage(msg, location.origin);
      } catch (_) { /* ignore */ }
    }

    window.addEventListener("message", function (e) {
      try {
        if (e.source !== window) return;
        var d = e.data;
        if (!d || d.__dc !== true || d.dir !== "toPage") return;
        var fn = handlers[d.type];
        if (!fn) return;
        Promise.resolve()
          .then(function () { return fn(d); })
          .then(function (data) { post({ type: "REPLY", key: d.key, data: data == null ? null : data }); })
          .catch(function (err) { post({ type: "REPLY", key: d.key, error: String((err && err.message) || err) }); });
      } catch (_) { /* ignore */ }
    });

    async function fetchText(url, credentials) {
      var res = await _fetch.call(window, url, { credentials: credentials });
      var text = await res.text();
      return { status: res.status, text: text };
    }

    // ------------------------------------------------------------ YouTube
    if (IS_YT) {
      var POT_KEY = "dc.pot.v1";
      var pots = new Map();
      try {
        var saved = JSON.parse(sessionStorage.getItem(POT_KEY) || "{}");
        Object.keys(saved || {}).forEach(function (k) { if (typeof saved[k] === "string") pots.set(k, saved[k]); });
      } catch (_) { /* ignore */ }

      var capture = function (raw) {
        try {
          if (!raw || String(raw).indexOf("/api/timedtext") === -1) return;
          var u = new URL(String(raw), location.href);
          var v = u.searchParams.get("v");
          var pot = u.searchParams.get("pot");
          if (!v || !pot || pots.get(v) === pot) return;
          pots.delete(v);
          pots.set(v, pot);
          while (pots.size > 12) pots.delete(pots.keys().next().value);
          try {
            var obj = {};
            pots.forEach(function (val, key) { obj[key] = val; });
            sessionStorage.setItem(POT_KEY, JSON.stringify(obj));
          } catch (_) { /* storage blocked */ }
          post({ type: "YT_POT", v: v });
        } catch (_) { /* ignore */ }
      };

      // Observe only: arguments pass through untouched.
      window.fetch = function (input) {
        try {
          var u = typeof input === "string" ? input : input && (input.url || input.href) ? input.url || input.href : "";
          if (u) capture(u);
        } catch (_) { /* ignore */ }
        return _fetch.apply(this, arguments);
      };
      var _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { capture(url && url.href ? url.href : url); } catch (_) { /* ignore */ }
        return _open.apply(this, arguments);
      };

      var potFromTiming = function (v) {
        try {
          var list = performance.getEntriesByType("resource");
          for (var i = list.length - 1; i >= 0; i--) {
            var name = list[i].name;
            if (name.indexOf("/api/timedtext") === -1) continue;
            var u = new URL(name);
            if (u.searchParams.get("v") === v && u.searchParams.get("pot")) return u.searchParams.get("pot");
          }
        } catch (_) { /* ignore */ }
        return null;
      };

      handlers.YT_PR = function () {
        var p = document.getElementById("movie_player");
        var pr = p && typeof p.getPlayerResponse === "function" ? p.getPlayerResponse() : null;
        if (!pr) return null;
        var list = (pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
          pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
        return {
          videoId: (pr.videoDetails && pr.videoDetails.videoId) || "",
          title: (pr.videoDetails && pr.videoDetails.title) || "",
          isLive: !!(pr.videoDetails && pr.videoDetails.isLive),
          tracks: list.map(P.simplifyYoutubeTrack)
        };
      };
      handlers.YT_GET_POT = function (d) {
        var pot = pots.get(d.v) || potFromTiming(d.v);
        if (pot && !pots.has(d.v)) pots.set(d.v, pot);
        return pot || null;
      };
      handlers.YT_FETCH = function (d) {
        return fetchText(d.url, "include");
      };
    }

    // ------------------------------------------------------------ Netflix
    if (IS_NF) {
      var _stringify = JSON.stringify;
      var _parse = JSON.parse;
      var manifests = new Map();

      JSON.stringify = function (value) {
        try {
          if (value && typeof value === "object") P.injectNetflixProfiles(value);
        } catch (_) { /* ignore */ }
        return _stringify.apply(this, arguments);
      };
      JSON.parse = function (text) {
        var out = _parse.apply(this, arguments);
        try {
          if (typeof text === "string" && text.length > 100 && P.mayCarryNetflixTracks(text)) {
            var m = P.extractNetflixManifest(out);
            if (m && m.tracks.length) {
              manifests.delete(m.movieId);
              manifests.set(m.movieId, m);
              while (manifests.size > 8) manifests.delete(manifests.keys().next().value);
              post({ type: "NFLX_MANIFEST", movieId: m.movieId, tracks: m.tracks, original: m.original || "" });
            }
          }
        } catch (_) { /* ignore */ }
        return out;
      };

      var player = function () {
        try {
          var nf = window.netflix;
          var app = nf && nf.appContext && (nf.appContext.state ? nf.appContext.state.playerApp :
            nf.appContext.getState && nf.appContext.getState().playerApp);
          var vp = app && app.getAPI && app.getAPI().videoPlayer;
          if (!vp) return null;
          var ids = (vp.getAllPlayerSessionIds && vp.getAllPlayerSessionIds()) || [];
          if (!ids.length) return null;
          return vp.getVideoPlayerBySessionId(ids[ids.length - 1]) || null;
        } catch (_) {
          return null;
        }
      };

      var prevTrack = null;
      var setNativeOff = function (off, attempt) {
        var pl = player();
        var list = pl && pl.getTimedTextTrackList && pl.getTimedTextTrackList();
        if (pl && pl.setTimedTextTrack && Array.isArray(list)) {
          try {
            if (off) {
              var none = list.find(function (t) { return t && t.isNoneTrack; });
              var cur = pl.getTimedTextTrack ? pl.getTimedTextTrack() : null;
              if (cur && !cur.isNoneTrack) prevTrack = cur;
              if (none) { pl.setTimedTextTrack(none); return; }
            } else {
              if (prevTrack) pl.setTimedTextTrack(prevTrack);
              prevTrack = null;
              return;
            }
          } catch (_) { /* retry below */ }
        }
        if ((attempt || 0) < 10) setTimeout(function () { setNativeOff(off, (attempt || 0) + 1); }, 500);
      };

      handlers.NFLX_GET_MANIFEST = function (d) {
        return manifests.get(String(d.movieId)) || null;
      };
      handlers.NFLX_FETCH = function (d) {
        return fetchText(d.url, "omit");
      };
      handlers.NFLX_CMD = function (d) {
        if (d.cmd === "nativeOff") { setNativeOff(true, 0); return true; }
        if (d.cmd === "nativeOn") { setNativeOff(false, 0); return true; }
        var pl = player();
        if (!pl) return false;
        if (d.cmd === "seek") pl.seek(Math.max(0, Math.round(Number(d.ms) || 0)));
        else if (d.cmd === "pause") pl.pause();
        else if (d.cmd === "play") pl.play();
        else return false;
        return true;
      };
    }

    // ------------------------------------------------------------ Generic video sites (embeds, open players)
    // Observe fetch/XHR for .vtt/.srt/subtitle playlists so DualCoach can load them.
    if (IS_GENERIC) {
      var captured = [];
      var seen = Object.create(null);

      function looksLikeSub(url) {
        if (!url) return false;
        var u = String(url);
        if (u.length > 4000) return false;
        if (/^(data|blob|javascript):/i.test(u)) return false;
        var low = u.toLowerCase();
        if (/\.(js|css|png|jpe?g|gif|webp|woff2?|ttf|mp4|m4s|ts|aac|m4a)([?#]|$)/.test(low)) return false;
        if (/\.(vtt|srt|ass|ssa)([?#]|$)/.test(low)) return true;
        if (/[?&](type|format|fmt|kind)=(vtt|srt|webvtt|subtitle|captions?)\b/.test(low)) return true;
        if (/(?:^|[?&/_.-])(subtitle|subtitles|caption|captions|timedtext|softsub|soft-sub)(?:[?&/_.-]|$)/.test(low)) {
          if (/\.(m3u8|json|xml|txt|vtt|srt)([?#]|$)/.test(low) || /[?&]/.test(low)) return true;
        }
        if (/\.m3u8([?#]|$)/.test(low) && /(subtitle|subtitles|vtt|textstream|timed-text)/.test(low)) return true;
        return false;
      }

      function guessLangFromUrl(url) {
        try {
          var path = new URL(url, location.href).pathname.toLowerCase();
          var m = path.match(/(?:^|[._/\-])([a-z]{2,3})(?:[._/\-](?:vtt|srt|ass|ssa))?$/i);
          if (m) {
            var map = { fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es", ita: "it", por: "pt", jpn: "ja", kor: "ko", chi: "zh", eng: "en" };
            var c = (map[m[1]] || m[1]).toLowerCase();
            if (c !== "vtt" && c !== "srt" && c !== "ass") return c;
          }
        } catch (_) {
          /* ignore */
        }
        return "";
      }

      function remember(url) {
        try {
          var abs = new URL(String(url), location.href).href;
          if (!looksLikeSub(abs) || seen[abs]) return;
          seen[abs] = true;
          var item = {
            url: abs,
            language: guessLangFromUrl(abs),
            label: abs.split("/").pop().split("?")[0] || "Subtitles",
            at: Date.now()
          };
          captured.push(item);
          if (captured.length > 40) captured.shift();
          post({ type: "GEN_SUB", track: item });
        } catch (_) {
          /* ignore */
        }
      }

      window.fetch = function (input) {
        try {
          var u = typeof input === "string" ? input : input && (input.url || input.href) ? input.url || input.href : "";
          if (u) remember(u);
        } catch (_) {
          /* ignore */
        }
        return _fetch.apply(this, arguments);
      };

      var _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          remember(url && url.href ? url.href : url);
        } catch (_) {
          /* ignore */
        }
        return _open.apply(this, arguments);
      };

      // Catch already-loaded subtitle resources (late injection)
      try {
        var list = performance.getEntriesByType("resource");
        for (var i = 0; i < list.length; i++) remember(list[i].name);
      } catch (_) {
        /* ignore */
      }

      handlers.GEN_LIST_SUBS = function () {
        return captured.slice();
      };
      handlers.GEN_FETCH = function (d) {
        return fetchText(d.url, "include");
      };
    }
  } catch (_) {
    /* never break the host page */
  }
})();
