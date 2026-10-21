// Pure subtitle/track helpers. Classic script: loaded in both content-script worlds and by Node tests.
(function (root) {
  "use strict";

  var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "", hellip: "…", mdash: "—", ndash: "–" };

  function collapse(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function decodeEntities(s) {
    return String(s || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, body) {
      if (body[0] === "#") {
        var hex = body[1] === "x" || body[1] === "X";
        var cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!isFinite(cp) || cp < 0 || cp > 0x10ffff) return m;
        try { return String.fromCodePoint(cp); } catch (_) { return m; }
      }
      var v = ENTITIES[body.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  // Sort by start, drop empties, clip each cue so it ends before the next one starts.
  function clipOverlaps(cues) {
    var out = cues
      .filter(function (c) { return c && c.text && isFinite(c.start) && isFinite(c.end) && c.end > c.start; })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    for (var i = 0; i < out.length - 1; i++) {
      var next = out[i + 1];
      if (out[i].end > next.start) out[i].end = Math.max(out[i].start + 0.001, next.start - 0.001);
    }
    return out;
  }

  // YouTube json3 → [{start,end,text,words?}]. words carry per-segment karaoke timing when present.
  function parseJson3(json) {
    var data = json;
    if (typeof json === "string") {
      if (!json.trim()) return [];
      data = JSON.parse(json);
    }
    var events = (data && data.events) || [];
    var cues = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev || !Array.isArray(ev.segs)) continue;
      var start = (Number(ev.tStartMs) || 0) / 1000;
      var dur = Number(ev.dDurationMs) || 0;
      var end = start + dur / 1000;
      var text = collapse(ev.segs.map(function (s) { return (s && s.utf8) || ""; }).join(""));
      if (!text) continue;
      var words = wordsFromJson3Segs(ev.segs, start, end);
      cues.push({ start: start, end: end, text: text, words: words });
    }
    return clipOverlaps(cues);
  }

  // Build [{text,start,end}] from YouTube json3 segs (tOffsetMs is relative to cue start).
  function wordsFromJson3Segs(segs, cueStart, cueEnd) {
    var raw = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s || s.utf8 == null) continue;
      var chunk = String(s.utf8).replace(/\n/g, " ");
      if (!chunk || !/\S/.test(chunk)) continue;
      var t0 = cueStart + (Number(s.tOffsetMs) || 0) / 1000;
      raw.push({ text: chunk, start: t0 });
    }
    if (!raw.length) return [];
    // Split whitespace-separated tokens; keep punctuation attached like tokenize does roughly.
    var out = [];
    for (var r = 0; r < raw.length; r++) {
      var piece = raw[r];
      var nextStart = r + 1 < raw.length ? raw[r + 1].start : cueEnd;
      var parts = piece.text.split(/(\s+)/);
      var timed = parts.filter(function (p) { return p && !/^\s+$/.test(p); });
      if (!timed.length) continue;
      var span = Math.max(0.04, nextStart - piece.start);
      var step = span / timed.length;
      for (var p = 0; p < timed.length; p++) {
        var w = collapse(timed[p]);
        if (!w) continue;
        var ws = piece.start + step * p;
        var we = p === timed.length - 1 ? nextStart : piece.start + step * (p + 1);
        out.push({ text: w, start: ws, end: Math.max(ws + 0.04, we) });
      }
    }
    if (out.length) out[out.length - 1].end = Math.max(out[out.length - 1].end, cueEnd);
    return out;
  }

  // Evenly space word tokens across a cue when the track has no per-word timing.
  function estimateWordTimings(text, cueStart, cueEnd, lang) {
    var toks = tokenize(text, lang).filter(function (t) { return t.w; });
    if (!toks.length) return [];
    var span = Math.max(0.2, (cueEnd || 0) - (cueStart || 0));
    var step = span / toks.length;
    return toks.map(function (t, i) {
      var s = cueStart + step * i;
      return { text: t.text, start: s, end: i === toks.length - 1 ? cueEnd : cueStart + step * (i + 1) };
    });
  }

  function activeWordIndex(words, t) {
    if (!words || !words.length || !isFinite(t)) return -1;
    for (var i = 0; i < words.length; i++) {
      if (t >= words[i].start && t < words[i].end) return i;
    }
    if (t >= words[words.length - 1].end) return words.length - 1;
    if (t < words[0].start) return -1;
    // Gap between words — pick the last started
    var best = -1;
    for (var j = 0; j < words.length; j++) {
      if (words[j].start <= t) best = j;
    }
    return best;
  }

  function parseTimestamp(s) {
    var m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(String(s).trim());
    if (!m) return NaN;
    var ms = m[4];
    while (ms.length < 3) ms += "0";
    return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(ms) / 1000;
  }

  function stripVttTags(s) {
    return String(s || "")
      .replace(/<\d{1,2}:\d{2}[:.]\d{2}[^>]*>/g, "")
      .replace(/<[^>]*>/g, "");
  }

  // WebVTT → [{start,end,text}]. Netflix splits a two-line subtitle into two cues with the
  // same timing and different `line:` settings; those are merged top to bottom.
  function parseVtt(text) {
    var src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var blocks = src.split(/\n{2,}/);
    var raw = [];
    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split("\n");
      var ti = -1;
      for (var k = 0; k < lines.length; k++) {
        if (lines[k].indexOf("-->") !== -1) { ti = k; break; }
      }
      if (ti === -1) continue;
      var m = /^\s*(\S+)\s+-->\s+(\S+)(.*)$/.exec(lines[ti]);
      if (!m) continue;
      var start = parseTimestamp(m[1]);
      var end = parseTimestamp(m[2]);
      if (!isFinite(start) || !isFinite(end)) continue;
      var lineSetting = /(?:^|\s)line:(-?[\d.]+)%?/.exec(m[3] || "");
      var body = lines.slice(ti + 1).map(function (l) { return collapse(decodeEntities(stripVttTags(l))); })
        .filter(Boolean).join(" ");
      body = collapse(body);
      if (!body) continue;
      raw.push({ start: start, end: end, text: body, line: lineSetting ? Number(lineSetting[1]) : null, order: raw.length });
    }
    var groups = {};
    var keys = [];
    raw.forEach(function (c) {
      var key = c.start.toFixed(3) + "|" + c.end.toFixed(3);
      if (!groups[key]) { groups[key] = []; keys.push(key); }
      groups[key].push(c);
    });
    var cues = keys.map(function (key) {
      var g = groups[key].slice().sort(function (a, b) {
        var la = a.line == null ? -Infinity : a.line;
        var lb = b.line == null ? -Infinity : b.line;
        return la - lb || a.order - b.order;
      });
      return { start: g[0].start, end: g[0].end, text: g.map(function (c) { return c.text; }).join(" ") };
    });
    cues.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return cues;
  }

  // SubRip (.srt) → [{start,end,text}]
  function parseSrt(text) {
    var src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!src) return [];
    var blocks = src.split(/\n{2,}/);
    var cues = [];
    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split("\n").map(function (l) { return l.trim(); }).filter(function (l, i, arr) {
        // drop leading index-only line
        return !(i === 0 && /^\d+$/.test(l) && arr.length > 1);
      });
      if (!lines.length) continue;
      var ti = -1;
      for (var k = 0; k < lines.length; k++) {
        if (lines[k].indexOf("-->") !== -1) { ti = k; break; }
      }
      if (ti === -1) continue;
      var m = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[ti]);
      if (!m) continue;
      var start = parseTimestamp(m[1].replace(",", "."));
      var end = parseTimestamp(m[2].replace(",", "."));
      if (!isFinite(start) || !isFinite(end)) continue;
      var body = collapse(lines.slice(ti + 1).map(function (l) {
        return decodeEntities(stripVttTags(l));
      }).filter(Boolean).join(" "));
      if (!body) continue;
      cues.push({ start: start, end: end, text: body });
    }
    return clipOverlaps(cues);
  }

  // Auto-detect WebVTT vs SRT from body (or filename hint).
  function parseSubtitleText(text, hint) {
    var raw = String(text || "");
    var h = String(hint || "").toLowerCase();
    if (h.indexOf(".srt") !== -1 || (/^\d+\s*\n\d{1,2}:\d{2}/.test(raw.trim()) && raw.indexOf("WEBVTT") === -1)) {
      return parseSrt(raw);
    }
    if (h.indexOf(".vtt") !== -1 || /^\s*WEBVTT/i.test(raw) || raw.indexOf("-->") !== -1) {
      var vtt = parseVtt(raw);
      if (vtt.length) return vtt;
      return parseSrt(raw);
    }
    var a = parseVtt(raw);
    if (a.length) return a;
    return parseSrt(raw);
  }

  // Closed-caption noise: [door creaks], (laughs), ♪, speaker labels like "JOHN:".
  function cleanCC(text) {
    var s = String(text || "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/（[^）]*）/g, " ")
      .replace(/［[^］]*］/g, " ")
      .replace(/(^\s*|[\-–—]\s*)[A-Z][A-Z0-9.'’&-]*(?: [A-Z0-9][A-Z0-9.'’&-]*)?:\s/g, "$1")
      .replace(/♪+/g, " ");
    // Dialogue dashes left with nothing after them (the whole line was a sound tag).
    s = collapse(s).replace(/(^|\s)[-–—](?=\s*(?:[-–—]\s|$))/g, "$1");
    return collapse(s);
  }

  // Some tracks (Netflix CC, older YouTube uploads) are ALL CAPS. If the whole track is mostly
  // uppercase, rewrite it in sentence case; sentence state carries across cues.
  var KEEP_UPPER = { tv: 1, ok: 1, fbi: 1, cia: 1, nasa: 1, dna: 1, ceo: 1, nyc: 1, usa: 1, uk: 1, ai: 1, ted: 1 };
  function isMostlyUpper(texts) {
    var up = 0, all = 0, letters = 0;
    texts.forEach(function (t) {
      var m = String(t || "").match(/[A-Za-z]/g) || [];
      all += m.length;
      letters += (String(t || "").match(/\p{L}/gu) || []).length;
      up += m.filter(function (ch) { return ch >= "A" && ch <= "Z"; }).length;
    });
    // Latin-script tracks only: a Korean track with a few acronyms must stay untouched.
    return all >= 20 && all / Math.max(1, letters) > 0.8 && up / all > 0.7;
  }
  function fixCaseLines(texts) {
    if (!isMostlyUpper(texts)) return texts;
    var capNext = true;
    return texts.map(function (t) {
      var s = String(t || "").toLowerCase().replace(/[a-z]+/g, function (w) {
        return KEEP_UPPER[w] ? w.toUpperCase() : w;
      });
      var out = "";
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (/[a-z]/.test(ch)) {
          out += capNext ? ch.toUpperCase() : ch;
          capNext = false;
        } else {
          if (/[A-Z0-9]/.test(ch)) capNext = false;
          else if (/[.!?]/.test(ch)) capNext = true;
          out += ch;
        }
      }
      return out.replace(/\bi\b(?=$|[\s'’.,!?;:-])/g, "I");
    });
  }

  // Pair each learn-language cue with the native cue(s) it overlaps most. → [{start,end,src,nat,words?}]
  function alignCues(src, nat, sameTiming) {
    src = src || [];
    nat = nat || [];
    if (sameTiming && nat.length === src.length) {
      return src.map(function (c, i) {
        return {
          start: c.start,
          end: c.end,
          src: c.text,
          nat: nat[i] ? nat[i].text : "",
          words: c.words || null
        };
      });
    }
    var j = 0;
    return src.map(function (c) {
      while (j < nat.length && nat[j].end <= c.start) j++;
      var picked = [];
      var best = null;
      var bestOv = 0;
      for (var k = j; k < nat.length && nat[k].start < c.end; k++) {
        var ov = Math.min(c.end, nat[k].end) - Math.max(c.start, nat[k].start);
        if (ov <= 0) continue;
        var kLen = nat[k].end - nat[k].start;
        // A native cue belongs here if most of it lies inside this cue.
        if (kLen > 0 && ov / kLen >= 0.5) picked.push(nat[k]);
        if (ov > bestOv) { bestOv = ov; best = nat[k]; }
      }
      if (!picked.length && best) picked = [best];
      return {
        start: c.start,
        end: c.end,
        src: c.text,
        nat: picked.map(function (p) { return p.text; }).join(" "),
        words: c.words || null
      };
    });
  }

  // ---- languages ----

  var LANG_ALIAS = { iw: "he", "in": "id", ji: "yi" };

  // "en-US" → "en", "zh-Hans"/"zh-CN" → "zh", "pt-BR" → "pt", "iw" → "he".
  function baseLang(code) {
    var c = String(code || "").trim().toLowerCase().replace(/_/g, "-");
    if (!c) return "";
    var b = c.split("-")[0];
    return LANG_ALIAS[b] || b;
  }

  function sameLang(a, b) {
    var x = baseLang(a);
    return !!x && x === baseLang(b);
  }

  // Latin abbreviations and numbers the word segmenter would split: U.S. / 10:30 / 3.5 / 1,000
  var PROTECT_RE = /(?:\p{Lu}\.){2,}|\p{N}+(?:[.,:]\p{N}+)+/gu;
  var FALLBACK_RE = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;
  var segmenters = {};

  function segmenterFor(lang) {
    var key = baseLang(lang) || "und";
    if (segmenters[key] !== undefined) return segmenters[key];
    var seg = null;
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) seg = new Intl.Segmenter(key === "und" ? undefined : key, { granularity: "word" });
    } catch (_) { seg = null; }
    segmenters[key] = seg;
    return seg;
  }

  function pushTok(out, w, text, start) {
    if (!text) return;
    var prev = out[out.length - 1];
    if (!w && prev && !prev.w && prev.end === start) {
      prev.text += text;
      prev.end = start + text.length;
      return;
    }
    out.push({ w: w, text: text, start: start, end: start + text.length });
  }

  function segmentInto(out, s, offset, lang) {
    if (!s) return;
    var seg = segmenterFor(lang);
    if (seg) {
      var it = seg.segment(s)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) {
        pushTok(out, !!r.value.isWordLike, r.value.segment, offset + r.value.index);
      }
      return;
    }
    var last = 0, m;
    FALLBACK_RE.lastIndex = 0;
    while ((m = FALLBACK_RE.exec(s))) {
      pushTok(out, false, s.slice(last, m.index), offset + last);
      pushTok(out, true, m[0], offset + m.index);
      last = m.index + m[0].length;
    }
    pushTok(out, false, s.slice(last), offset + last);
  }

  // → [{w:true|false, text, start, end}] covering the whole string. Word boundaries come from
  // Intl.Segmenter, so scripts without spaces (ja/zh/th) split into clickable words too.
  function tokenize(text, lang) {
    var s = String(text || "");
    var out = [];
    var last = 0, m;
    PROTECT_RE.lastIndex = 0;
    while ((m = PROTECT_RE.exec(s))) {
      segmentInto(out, s.slice(last, m.index), last, lang);
      pushTok(out, true, m[0], m.index);
      last = m.index + m[0].length;
    }
    segmentInto(out, s.slice(last), last, lang);
    return out;
  }

  // Index of the last cue with start <= t, or -1.
  function floorCue(cues, t) {
    var lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // Index of the cue active at t, or -1 in a gap.
  function findCue(cues, t) {
    var i = floorCue(cues, t);
    return i !== -1 && t < cues[i].end ? i : -1;
  }

  // ---- YouTube ----

  function buildTimedTextUrl(baseUrl, opts) {
    opts = opts || {};
    var u = new URL(baseUrl, opts.base || "https://www.youtube.com");
    u.searchParams.set("fmt", "json3");
    u.searchParams.set("c", "WEB");
    if (opts.tlang) u.searchParams.set("tlang", opts.tlang);
    else u.searchParams.delete("tlang");
    if (opts.pot) u.searchParams.set("pot", opts.pot);
    return u.toString();
  }

  function simplifyYoutubeTrack(t) {
    var name = "";
    if (t && t.name) name = t.name.simpleText || (t.name.runs && t.name.runs[0] && t.name.runs[0].text) || "";
    return {
      baseUrl: String((t && t.baseUrl) || ""),
      languageCode: String((t && t.languageCode) || ""),
      kind: String((t && t.kind) || ""),
      name: String(name)
    };
  }

  // YouTube's tlang codes differ from BCP 47 base codes for a few languages.
  var YT_TLANG = { zh: "zh-Hans", he: "iw" };
  function ytTlang(lang) {
    var b = baseLang(lang);
    return YT_TLANG[b] || b;
  }

  // opts = {learn: "auto"|code, native: code, allowMT: bool}
  // → {learn: track|null, learnLang, nativeLang, native: {track, tlang, kind:"official"|"asr"|"mt"}|null,
  //    same: bool, missing: requested learn code with no track | ""}
  function planYoutubeTracks(tracks, opts) {
    opts = opts || {};
    var nativeLang = baseLang(opts.native) || "en";
    var want = opts.learn && opts.learn !== "auto" ? baseLang(opts.learn) : "";
    tracks = (tracks || []).filter(function (t) { return t && t.baseUrl; });
    var manual = tracks.filter(function (t) { return t.kind !== "asr"; });
    var asr = tracks.filter(function (t) { return t.kind === "asr"; });
    function pickIn(lang, list) {
      for (var i = 0; i < list.length; i++) if (sameLang(list[i].languageCode, lang)) return list[i];
      return null;
    }
    function trackIn(lang) { return lang ? pickIn(lang, manual) || pickIn(lang, asr) : null; }

    // The spoken language: the ASR track is generated from the audio.
    var spoken = asr[0] ? baseLang(asr[0].languageCode) : "";
    var foreign = manual.filter(function (t) { return !sameLang(t.languageCode, nativeLang); })[0];
    var autoLang = spoken || (foreign ? baseLang(foreign.languageCode) : "") || (manual[0] ? baseLang(manual[0].languageCode) : "");

    var learnLang = want || autoLang;
    var learn = trackIn(learnLang);
    var missing = "";
    if (!learn && want) {
      missing = want;
      learnLang = autoLang;
      learn = trackIn(learnLang);
    }
    var out = { learn: learn, learnLang: learnLang, nativeLang: nativeLang, native: null, same: false, missing: missing };
    if (!learn) return out;
    if (learnLang === nativeLang) {
      out.same = true;
      return out;
    }
    var m = pickIn(nativeLang, manual);
    var a = pickIn(nativeLang, asr);
    if (m) out.native = { track: m, tlang: "", kind: "official" };
    else if (a) out.native = { track: a, tlang: "", kind: "asr" };
    else if (opts.allowMT !== false) out.native = { track: learn, tlang: ytTlang(nativeLang), kind: "mt" };
    return out;
  }

  // ---- Netflix ----

  var WEBVTT_PROFILE = "webvtt-lssdh-ios8";
  var MANIFEST_URL_RE = /manifest|licensedManifest/i;

  function bfs(root, limit, visit) {
    if (!root || typeof root !== "object") return;
    var queue = [root];
    var seen = 0;
    while (queue.length && seen < limit) {
      var node = queue.shift();
      seen++;
      if (!node || typeof node !== "object") continue;
      if (visit(node) === true) return;
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) {
        var v = node[keys[i]];
        if (v && typeof v === "object") queue.push(v);
      }
    }
  }

  // Mutates a manifest request body so Netflix also offers WebVTT subtitle files.
  function injectNetflixProfiles(obj) {
    var isManifest = false;
    bfs(obj, 500, function (n) {
      if (typeof n.url === "string" && MANIFEST_URL_RE.test(n.url)) { isManifest = true; return true; }
    });
    if (!isManifest) return false;
    var changed = false;
    bfs(obj, 500, function (n) {
      var p = n.profiles;
      if (Array.isArray(p) && p.length && p.every(function (x) { return typeof x === "string"; }) && p.indexOf(WEBVTT_PROFILE) === -1) {
        p.push(WEBVTT_PROFILE);
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(n, "showAllSubDubTracks") && n.showAllSubDubTracks !== true) {
        n.showAllSubDubTracks = true;
        changed = true;
      }
    });
    return changed;
  }

  function looksLikeTracks(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    var f = arr[0];
    return !!f && typeof f === "object" && ("downloadables" in f || "ttDownloadables" in f || "isNoneTrack" in f);
  }

  function vttUrlOf(t) {
    var d = t.downloadables || t.ttDownloadables;
    var p = d && d[WEBVTT_PROFILE];
    if (!p) return "";
    if (Array.isArray(p.urls) && p.urls[0] && p.urls[0].url) return String(p.urls[0].url);
    var vals = p.downloadUrls ? Object.keys(p.downloadUrls).map(function (k) { return p.downloadUrls[k]; }) : [];
    return vals[0] ? String(vals[0]) : "";
  }

  function simplifyNetflixTrack(t) {
    return {
      id: t.id != null ? String(t.id) : t.new_track_id != null ? String(t.new_track_id) : "",
      language: String(t.language || t.bcp47 || ""),
      languageDescription: String(t.languageDescription || ""),
      rawTrackType: String(t.rawTrackType || t.trackType || ""),
      isForcedNarrative: !!t.isForcedNarrative,
      isNoneTrack: !!t.isNoneTrack,
      url: vttUrlOf(t)
    };
  }

  // Original-language audio track, when the manifest marks one (isNative / "[Original]" description).
  function originalAudioLang(n) {
    var aud = Array.isArray(n.audioTracks) ? n.audioTracks : Array.isArray(n.audio_tracks) ? n.audio_tracks : [];
    for (var i = 0; i < aud.length; i++) {
      var a = aud[i];
      if (!a || typeof a !== "object") continue;
      if (a.isNative === true || a.isOriginal === true || /original/i.test(String(a.languageDescription || ""))) {
        return String(a.language || a.bcp47 || "");
      }
    }
    return "";
  }

  // → {movieId, tracks: simplified[], original: audio language code | ""} | null
  function extractNetflixManifest(obj) {
    var found = null;
    bfs(obj, 2000, function (n) {
      if (n.movieId == null || (typeof n.movieId !== "number" && typeof n.movieId !== "string")) return;
      var arr = looksLikeTracks(n.textTracks) ? n.textTracks : looksLikeTracks(n.timedtexttracks) ? n.timedtexttracks : null;
      if (!arr) return;
      found = {
        movieId: String(n.movieId),
        tracks: arr.filter(function (t) { return t && typeof t === "object"; }).map(simplifyNetflixTrack),
        original: originalAudioLang(n)
      };
      return true;
    });
    return found;
  }

  function mayCarryNetflixTracks(text) {
    return typeof text === "string" && /downloadables|ttDownloadables|isNoneTrack/.test(text);
  }

  // opts = {learn: "auto"|code, native: code, original: audio language code}
  // → {learn, native (tracks | null), learnLang, nativeLang, same, missing}
  function pickNetflixTracks(tracks, opts) {
    opts = opts || {};
    var nativeLang = baseLang(opts.native) || "en";
    var want = opts.learn && opts.learn !== "auto" ? baseLang(opts.learn) : "";
    tracks = (tracks || []).filter(function (t) { return t && !t.isNoneTrack && !t.isForcedNarrative; });
    function pickIn(lang) {
      if (!lang) return null;
      var list = tracks.filter(function (t) { return sameLang(t.language, lang); });
      list.sort(function (a, b) {
        var sa = /^subtitles$/i.test(a.rawTrackType) ? 0 : 1;
        var sb = /^subtitles$/i.test(b.rawTrackType) ? 0 : 1;
        var ua = a.url ? 0 : 1, ub = b.url ? 0 : 1;
        return ua - ub || sa - sb;
      });
      return list[0] || null;
    }
    var original = baseLang(opts.original);
    var foreign = tracks.filter(function (t) { return !sameLang(t.language, nativeLang); })[0];
    var autoLang = (original && pickIn(original) ? original : "") ||
      (foreign ? baseLang(foreign.language) : "") || original || (tracks[0] ? baseLang(tracks[0].language) : "");

    var learnLang = want || autoLang;
    var learn = pickIn(learnLang);
    var missing = "";
    if (!learn && want) {
      missing = want;
      learnLang = autoLang;
      learn = pickIn(learnLang);
    }
    var same = !!learn && learnLang === nativeLang;
    return {
      learn: learn,
      native: learn && !same ? pickIn(nativeLang) : null,
      learnLang: learnLang,
      nativeLang: nativeLang,
      same: same,
      missing: missing
    };
  }

  root.DC_PARSERS = {
    collapse: collapse,
    decodeEntities: decodeEntities,
    clipOverlaps: clipOverlaps,
    parseJson3: parseJson3,
    wordsFromJson3Segs: wordsFromJson3Segs,
    estimateWordTimings: estimateWordTimings,
    activeWordIndex: activeWordIndex,
    parseTimestamp: parseTimestamp,
    parseVtt: parseVtt,
    parseSrt: parseSrt,
    parseSubtitleText: parseSubtitleText,
    cleanCC: cleanCC,
    fixCaseLines: fixCaseLines,
    alignCues: alignCues,
    baseLang: baseLang,
    sameLang: sameLang,
    tokenize: tokenize,
    floorCue: floorCue,
    findCue: findCue,
    buildTimedTextUrl: buildTimedTextUrl,
    simplifyYoutubeTrack: simplifyYoutubeTrack,
    ytTlang: ytTlang,
    planYoutubeTracks: planYoutubeTracks,
    WEBVTT_PROFILE: WEBVTT_PROFILE,
    injectNetflixProfiles: injectNetflixProfiles,
    extractNetflixManifest: extractNetflixManifest,
    mayCarryNetflixTracks: mayCarryNetflixTracks,
    pickNetflixTracks: pickNetflixTracks
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
