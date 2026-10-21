// YouTube adapter: track list from the player, json3 fetch with the pot token, CC toggle to mint one.
(function () {
  "use strict";
  var DC = window.DC;
  var P = DC.P;
  var HIDE_CSS_ID = "dc-hide-yt-captions";

  DC.youtube = function () {
    var ctl = null;
    var currentVid = "";
    var token = 0;
    var status = "idle"; // idle | loading | ready | failed
    var title = "";
    var diag = (DC.diag = { site: "youtube" });

    function player() { return document.getElementById("movie_player"); }

    var adapter = {
      site: "youtube",
      bottom: "calc(4% + 50px)",
      sideBottom: "52px",
      container: function () { return player(); },
      video: function () {
        var p = player();
        return (p && p.querySelector("video.html5-main-video")) || document.querySelector("video.html5-main-video");
      },
      seek: function (sec) { var v = adapter.video(); if (v) v.currentTime = Math.max(0, sec); },
      pause: function () { var v = adapter.video(); if (v && !v.paused) v.pause(); },
      play: function () { var v = adapter.video(); if (v && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } },
      hideNative: function (hide) {
        var el = document.getElementById(HIDE_CSS_ID);
        if (hide) {
          if (!el) {
            el = document.createElement("style");
            el.id = HIDE_CSS_ID;
            el.textContent = ".ytp-caption-window-container{display:none !important}";
            (document.head || document.documentElement).appendChild(el);
          }
          setCC(false);
        } else if (el) {
          el.remove();
        }
      },
      showNative: function () { setCC(true); },
      title: function () { return title || document.title.replace(/\s*-\s*YouTube\s*$/, ""); },
      link: function (sec) {
        return "https://www.youtube.com/watch?v=" + currentVid + (sec ? "&t=" + Math.floor(sec) + "s" : "");
      }
    };

    function urlVideoId() {
      try {
        var u = new URL(location.href);
        if (u.pathname === "/watch") return u.searchParams.get("v") || "";
      } catch (_) { /* ignore */ }
      return "";
    }

    function ccButton() {
      var p = player();
      return p && p.querySelector(".ytp-subtitles-button");
    }
    function ccOn() {
      var b = ccButton();
      return !!b && b.getAttribute("aria-pressed") === "true";
    }
    function setCC(on) {
      var b = ccButton();
      if (!b) return false;
      if (ccOn() !== on) b.click();
      return true;
    }
    function isAd() {
      var p = player();
      return !!p && p.classList.contains("ad-showing");
    }

    function ensureCtl() {
      if (!ctl) ctl = DC.createOverlay(adapter);
      return ctl;
    }

    function stale(t) { return t !== token || !DC.running; }

    async function waitPlayerResponse(vid, t) {
      var deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        if (stale(t)) return null;
        try {
          var pr = await DC.page.request("YT_PR", {}, 3000);
          if (pr && pr.videoId === vid) return pr;
        } catch (_) { /* retry */ }
        await DC.sleep(100);
      }
      return null;
    }

    async function getPot(vid) {
      try { return await DC.page.request("YT_GET_POT", { v: vid }, 3000); } catch (_) { return null; }
    }

    async function fetchTrack(vid, baseUrl, tlang) {
      var pot = await getPot(vid);
      var url = P.buildTimedTextUrl(baseUrl, { tlang: tlang, pot: pot });
      var res;
      try {
        res = await DC.page.request("YT_FETCH", { url: url }, 20000);
      } catch (e) {
        return { status: 0, cues: [], pot: pot, error: String(e && e.message) };
      }
      var cues = [];
      if (res && res.status === 200 && res.text && res.text.trim()) {
        try { cues = P.parseJson3(res.text); } catch (_) { cues = []; }
      }
      (diag.attempts = diag.attempts || []).push({ tlang: tlang || "", pot: !!pot, status: res ? res.status : 0, len: res && res.text ? res.text.length : 0, cues: cues.length });
      return { status: res ? res.status : 0, empty: !(res && res.text && res.text.trim()), cues: cues, pot: pot };
    }

    // Briefly turn the player's own captions on so it requests a track with `pot`, which the hook records.
    // One attempt; the caller retries (the CC button can render late and the first toggle can be ignored).
    async function mintPot(vid, t, attempt) {
      var adWait = Date.now() + 120000;
      while (isAd() && Date.now() < adWait) {
        if (stale(t)) return null;
        await DC.sleep(500);
      }
      if (stale(t) || isAd()) return null;
      var btnWait = Date.now() + 10000;
      while (!ccButton() && Date.now() < btnWait) {
        if (stale(t)) return null;
        await DC.sleep(250);
      }
      var b = ccButton();
      if (!b) return null;
      diag.minted = "attempt " + attempt;
      if (ccOn()) {
        b.click();
        await DC.sleep(300);
      }
      b.click();
      var pot = null;
      var deadline = Date.now() + 8000 + attempt * 2000;
      while (Date.now() < deadline && !stale(t)) {
        pot = await getPot(vid);
        if (pot) break;
        await DC.sleep(200);
      }
      setCC(false);
      diag.minted = pot ? "ok (attempt " + attempt + ")" : "no-token";
      return pot;
    }

    function clean(cues) {
      return cues
        .map(function (c) {
          return { start: c.start, end: c.end, text: P.cleanCC(c.text), words: c.words || null };
        })
        .filter(function (c) {
          return c.text;
        });
    }

    // Per-video cache of fetched tracks, so a language change re-plans without refetching.
    var fetched = {};
    async function fetchCached(vid, baseUrl, tlang) {
      var key = baseUrl + "|" + (tlang || "");
      if (fetched[key]) return fetched[key];
      var r = await fetchTrack(vid, baseUrl, tlang);
      if (r.cues.length) fetched[key] = r;
      return r;
    }

    function trackDesc(x) { return x ? x.languageCode + (x.kind ? "(" + x.kind + ")" : "") : null; }

    async function load(vid, t) {
      status = "loading";
      var pr = await waitPlayerResponse(vid, t);
      if (stale(t)) return;
      if (!pr) { status = "idle"; return; }
      if (pr.isLive) { status = "idle"; return; }
      title = pr.title || "";
      var s = DC.settings;
      var plan = P.planYoutubeTracks(pr.tracks, { learn: s.learnLang, native: s.nativeLang, allowMT: s.autoTranslate });
      diag.videoId = vid;
      diag.tracks = pr.tracks.map(function (x) { return x.languageCode + (x.kind ? "(" + x.kind + ")" : "") + " " + x.name; });
      diag.plan = {
        learnLang: plan.learnLang, nativeLang: plan.nativeLang, learn: trackDesc(plan.learn),
        native: plan.native ? { track: trackDesc(plan.native.track), tlang: plan.native.tlang, kind: plan.native.kind } : null,
        same: plan.same, missing: plan.missing
      };
      DC.log("tracks", diag.tracks, "plan", diag.plan);
      if (!plan.learn) {
        status = "idle";
        ensureCtl().clear();
        ensureCtl().toast(pr.tracks.length
          ? "No " + DC.langName(plan.missing || plan.learnLang) + " subtitles on this video"
          : "This video has no subtitles", 4000);
        return;
      }

      var learn = await fetchCached(vid, plan.learn.baseUrl, "");
      if (stale(t)) return;
      diag.potInitially = !!learn.pot;
      for (var attempt = 1; attempt <= 3 && !learn.cues.length && learn.empty; attempt++) {
        var pot = await mintPot(vid, t, attempt);
        if (stale(t)) return;
        if (pot) learn = await fetchCached(vid, plan.learn.baseUrl, "");
        if (stale(t)) return;
        if (!learn.cues.length) await DC.sleep(1500);
      }
      diag.learnStatus = learn.status;
      diag.learnCues = learn.cues.length;
      if (!learn.cues.length) {
        status = "failed";
        ensureCtl().toast("Couldn't load subtitles — turn on the player's CC button once", 5000);
        return;
      }

      var learnName = DC.langName(plan.learnLang), nativeName = DC.langName(plan.nativeLang);
      var nat = null, note = "", kind = "";
      if (plan.native) {
        var nr = await fetchCached(vid, plan.native.track.baseUrl, plan.native.tlang);
        if (stale(t)) return;
        diag.nativeStatus = nr.status;
        diag.nativeCues = nr.cues.length;
        if (nr.cues.length) {
          nat = nr.cues;
          kind = plan.native.kind;
        } else if (plan.native.tlang && nr.status === 429) {
          note = "Auto-translation is temporarily unavailable";
        } else {
          note = "Couldn't load " + nativeName + " subtitles";
        }
      } else if (!plan.same) {
        note = "No " + nativeName + " subtitles";
      }

      var sameTiming = !!(plan.native && plan.native.tlang && nat && nat.length === learn.cues.length);
      var aligned = sameTiming
        ? learn.cues
            .map(function (c, i) {
              return {
                start: c.start,
                end: c.end,
                src: P.cleanCC(c.text),
                nat: nat[i].text,
                words: c.words || null
              };
            })
            .filter(function (c) {
              return c.src;
            })
        : P.alignCues(clean(learn.cues), nat || [], false);
      var fixed = P.fixCaseLines(aligned.map(function (c) { return c.src; }));
      aligned.forEach(function (c, i) { c.src = fixed[i]; });
      status = "ready";
      var label = nat ? learnName + " + " + nativeName + (kind === "mt" ? " (auto-translated)" : "") : learnName + " only";
      diag.label = label;
      diag.nativeKind = kind || "(none)";
      diag.note = note;
      var c = ensureCtl();
      c.setCues(aligned, { learnLang: plan.learnLang, nativeLang: plan.nativeLang, nativeKind: kind, label: label, note: note });
      if (plan.missing) c.toast("No " + DC.langName(plan.missing) + " subtitles on this video — showing " + learnName, 5000);
      else if (plan.same) c.toast("This video is in your language — pick a language to learn in settings", 5000);
      else c.toast(nat ? "Loaded " + label : "Showing " + learnName + " only — " + note);
    }

    function onNavigate() {
      if (!DC.running) return;
      var vid = urlVideoId();
      if (vid === currentVid) return;
      currentVid = vid;
      token++;
      status = "idle";
      title = "";
      fetched = {};
      if (ctl) ctl.clear();
      if (vid) load(vid, token);
    }

    DC.page.on("YT_POT", function (d) {
      if (d.v === currentVid && status === "failed") {
        DC.log("late pot, retrying");
        token++;
        load(currentVid, token);
      }
    });

    var playRetriedFor = "";
    // Media events don't bubble, but capture on document sees them.
    document.addEventListener("playing", function (e) {
      if (!e.target || !e.target.classList || !e.target.classList.contains("html5-main-video")) return;
      if (status === "failed" && currentVid && playRetriedFor !== currentVid) {
        playRetriedFor = currentVid;
        DC.log("retry on play");
        token++;
        load(currentVid, token);
      }
    }, true);

    document.addEventListener("yt-navigate-finish", function () { setTimeout(onNavigate, 0); });
    var poll = setInterval(onNavigate, 1000);

    return {
      start: function () { onNavigate(); },
      stop: function () {
        token++;
        currentVid = "";
        status = "idle";
        if (ctl) { ctl.destroy(); ctl = null; }
      },
      applySettings: function (prev) {
        if (ctl) ctl.applySettings();
        var s = DC.settings;
        if (prev && currentVid && (prev.autoTranslate !== s.autoTranslate || prev.learnLang !== s.learnLang || prev.nativeLang !== s.nativeLang)) {
          token++;
          load(currentVid, token);
        }
      },
      ctl: function () { return ctl; },
      _poll: poll
    };
  };
})();
