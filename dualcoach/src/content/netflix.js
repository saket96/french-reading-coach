// Netflix adapter: manifest captured by the MAIN hook, WebVTT fetch, player API for seek/pause/play.
(function () {
  "use strict";
  var DC = window.DC;
  var P = DC.P;
  var HIDE_CSS_ID = "dc-hide-nflx-captions";

  DC.netflix = function () {
    var ctl = null;
    var currentId = "";
    var token = 0;
    var waiting = null; // {id, t} while waiting for a manifest
    var diag = (DC.diag = { site: "netflix" });

    function cmd(name, ms) {
      return DC.page.request("NFLX_CMD", { cmd: name, ms: ms }, 3000).catch(function () { return false; });
    }

    var adapter = {
      site: "netflix",
      bottom: "10%",
      sideBottom: "0px",
      container: function () {
        var v = adapter.video();
        return document.querySelector(".watch-video--player-view") || document.querySelector(".watch-video") ||
          (v && v.parentElement) || null;
      },
      video: function () {
        return document.querySelector(".watch-video video") || document.querySelector("video");
      },
      // Never touch video.currentTime on Netflix (error M7375): go through the player API.
      seek: function (sec) { cmd("seek", Math.round(Math.max(0, sec) * 1000)); },
      pause: function () { cmd("pause"); },
      play: function () { cmd("play"); },
      hideNative: function (hide) {
        var el = document.getElementById(HIDE_CSS_ID);
        if (hide) {
          if (!el) {
            el = document.createElement("style");
            el.id = HIDE_CSS_ID;
            el.textContent = ".player-timedtext{display:none !important}";
            (document.head || document.documentElement).appendChild(el);
          }
          cmd("nativeOff");
        } else {
          if (el) el.remove();
          cmd("nativeOn");
        }
      },
      title: function () {
        var h = document.querySelector("[data-uia='video-title']");
        var t = h ? h.textContent : "";
        return (t || document.title.replace(/\s*[-|]\s*Netflix\s*$/i, "")).replace(/\s+/g, " ").trim();
      },
      link: function (sec) {
        return "https://www.netflix.com/watch/" + currentId + (sec ? "?t=" + Math.floor(sec) : "");
      }
    };

    function urlId() {
      var m = /\/watch\/(\d+)/.exec(location.pathname);
      return m ? m[1] : "";
    }

    function ensureCtl() {
      if (!ctl) ctl = DC.createOverlay(adapter);
      return ctl;
    }

    function stale(t) { return t !== token || !DC.running; }

    async function fetchVtt(url) {
      var res = await DC.page.request("NFLX_FETCH", { url: url }, 20000);
      if (!res || res.status !== 200 || !res.text) throw new Error("vtt http " + (res && res.status));
      return P.parseVtt(res.text);
    }

    async function waitForContainer(t) {
      for (var i = 0; i < 60; i++) {
        if (stale(t)) return false;
        if (adapter.container() && adapter.video()) return true;
        await DC.sleep(500);
      }
      return false;
    }

    var lastManifest = null;
    var vttCache = {};
    async function fetchVttCached(url) {
      if (!vttCache[url]) vttCache[url] = fetchVtt(url).catch(function (e) { delete vttCache[url]; throw e; });
      return vttCache[url];
    }

    function trackDesc(x) { return x ? x.language + " " + x.rawTrackType : null; }

    async function useManifest(m, t) {
      waiting = null;
      lastManifest = m;
      var s = DC.settings;
      var pick = P.pickNetflixTracks(m.tracks, { learn: s.learnLang, native: s.nativeLang, original: m.original });
      diag.movieId = m.movieId;
      diag.original = m.original || "";
      diag.tracks = m.tracks.map(function (x) { return x.language + " " + x.rawTrackType + (x.isForcedNarrative ? " forced" : "") + (x.url ? "" : " (no vtt)"); });
      diag.plan = { learnLang: pick.learnLang, nativeLang: pick.nativeLang, learn: trackDesc(pick.learn), native: trackDesc(pick.native), same: pick.same, missing: pick.missing };
      if (!(await waitForContainer(t))) return;
      if (!pick.learn) {
        ensureCtl().clear();
        ensureCtl().toast("No " + DC.langName(pick.missing || pick.learnLang) + " subtitles for this title", 4000);
        return;
      }
      if (!pick.learn.url) {
        ensureCtl().toast("Couldn't load subtitles — reload the page", 5000);
        return;
      }
      var learn;
      try {
        learn = await fetchVttCached(pick.learn.url);
      } catch (e) {
        if (stale(t)) return;
        ensureCtl().toast("Couldn't load subtitles", 4000);
        return;
      }
      if (stale(t)) return;
      learn = learn.map(function (c) { return { start: c.start, end: c.end, text: P.cleanCC(c.text) }; })
        .filter(function (c) { return c.text; });
      var fixed = P.fixCaseLines(learn.map(function (c) { return c.text; }));
      learn.forEach(function (c, i) { c.text = fixed[i]; });
      var learnName = DC.langName(pick.learnLang), nativeName = DC.langName(pick.nativeLang);
      var nat = null, note = "";
      if (pick.native && pick.native.url) {
        try { nat = await fetchVttCached(pick.native.url); } catch (_) { nat = null; }
        if (stale(t)) return;
        if (!nat || !nat.length) note = "Couldn't load " + nativeName + " subtitles";
      } else if (!pick.same) {
        note = "No " + nativeName + " subtitles";
      }
      diag.learnCues = learn.length;
      diag.nativeCues = nat ? nat.length : 0;
      var aligned = P.alignCues(learn, nat || [], false);
      var hasNat = !!(nat && nat.length);
      var label = hasNat ? learnName + " + " + nativeName : learnName + " only";
      diag.label = label;
      diag.note = note;
      var c = ensureCtl();
      c.setCues(aligned, { learnLang: pick.learnLang, nativeLang: pick.nativeLang, nativeKind: hasNat ? "official" : "", label: label, note: note });
      if (pick.missing) c.toast("No " + DC.langName(pick.missing) + " subtitles for this title — showing " + learnName, 5000);
      else if (pick.same) c.toast("This title is in your language — pick a language to learn in settings", 5000);
      else c.toast(hasNat ? "Loaded " + label : "Showing " + learnName + " only — " + note);
    }

    async function load(id, t) {
      var m = null;
      try { m = await DC.page.request("NFLX_GET_MANIFEST", { movieId: id }, 3000); } catch (_) { m = null; }
      if (stale(t)) return;
      if (m && m.movieId === id) { useManifest(m, t); return; }
      waiting = { id: id, t: t };
      setTimeout(function () {
        if (waiting && waiting.t === t && !stale(t)) {
          ensureCtl().toast("Couldn't find subtitle info — reload the page", 5000);
        }
      }, 20000);
    }

    DC.page.on("NFLX_MANIFEST", function (d) {
      if (waiting && d.movieId === waiting.id && !stale(waiting.t)) {
        useManifest({ movieId: d.movieId, tracks: d.tracks || [], original: d.original || "" }, waiting.t);
      }
    });

    function check() {
      if (!DC.running) return;
      var id = urlId();
      if (id === currentId) return;
      currentId = id;
      token++;
      waiting = null;
      lastManifest = null;
      vttCache = {};
      if (ctl) ctl.clear();
      if (id) load(id, token);
    }
    setInterval(check, 500);

    return {
      start: function () { check(); },
      stop: function () {
        token++;
        currentId = "";
        waiting = null;
        if (ctl) { ctl.destroy(); ctl = null; }
      },
      applySettings: function (prev) {
        if (ctl) ctl.applySettings();
        var s = DC.settings;
        if (prev && lastManifest && lastManifest.movieId === currentId && (prev.learnLang !== s.learnLang || prev.nativeLang !== s.nativeLang)) {
          token++;
          useManifest(lastManifest, token);
        }
      },
      ctl: function () { return ctl; }
    };
  };
})();
