// Unit tests for src/content/parsers.js (pure functions). Run: node tools/test-parsers.mjs
import fs from "fs";
import path from "path";
import vm from "vm";
import assert from "assert/strict";

const here = path.dirname(new URL(import.meta.url).pathname);
vm.runInThisContext(fs.readFileSync(path.join(here, "../src/content/parsers.js"), "utf8"));
const P = globalThis.DC_PARSERS;

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ok   " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL " + name + "\n       " + String(e.message).split("\n").join("\n       "));
  }
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- json3
const JSON3 = {
  wireMagic: "pb3",
  events: [
    { tStartMs: 0, dDurationMs: 1500, id: 1 }, // window event, no segs
    { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: "so " }, { utf8: "I", tOffsetMs: 200 }, { utf8: " went" }] },
    { tStartMs: 2500, dDurationMs: 3000, segs: [{ utf8: "\n" }] }, // blank line event
    { tStartMs: 3000, dDurationMs: 4200, segs: [{ utf8: "to the\n  store" }] },
    { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: "yesterday" }] },
    { tStartMs: 9000, dDurationMs: 1000, segs: [{ utf8: "[Music]" }] }
  ]
};
test("json3: drops empty events, collapses whitespace, clips overlapping ASR cues", () => {
  const cues = P.parseJson3(JSON.stringify(JSON3));
  assert.deepEqual(cues.map((c) => c.text), ["so I went", "to the store", "yesterday", "[Music]"]);
  assert.equal(r3(cues[0].start), 1);
  assert.equal(r3(cues[0].end), 2.999); // clipped to next.start - 0.001
  assert.equal(r3(cues[1].end), 5.999);
  assert.equal(r3(cues[2].end), 8);
  for (let i = 0; i < cues.length - 1; i++) assert.ok(cues[i].end < cues[i + 1].start);
});
test("json3: empty body → []", () => {
  assert.deepEqual(P.parseJson3(""), []);
  assert.deepEqual(P.parseJson3({}), []);
});

// ---------------------------------------------------------------- WebVTT
const VTT = `WEBVTT

NOTE Netflix-style file

3
00:00:05.000 --> 00:00:07.500 position:50.00%,middle align:middle size:80.00% line:85%
<c.bg_transparent>&lt;second line&gt; &amp; more</c.bg_transparent>

2
00:00:05.000 --> 00:00:07.500 position:50.00%,middle align:middle size:80.00% line:79%
<c.bg_transparent><i>First line</i> is here</c.bg_transparent>

1
00:00:01.000 --> 00:00:02.250 line:85%
<v John>Hello,&nbsp;there</v>

4
01:02.500 --> 01:04.000
<b>Short</b> stamp &#39;ok&#39; &#x2014; fine

5
00:00:08.000 --> 00:00:09.000
- [door creaks]
- JOHN: Who's there? (laughs)
`;
test("vtt: merges same-timing split cues by line% ascending, sorts, strips tags, decodes entities", () => {
  const cues = P.parseVtt(VTT);
  assert.deepEqual(
    cues.map((c) => [r3(c.start), r3(c.end), c.text]),
    [
      [1, 2.25, "Hello, there"],
      [5, 7.5, "First line is here <second line> & more"],
      [8, 9, "- [door creaks] - JOHN: Who's there? (laughs)"],
      [62.5, 64, "Short stamp 'ok' — fine"]
    ]
  );
});
test("vtt: timestamp formats", () => {
  assert.equal(P.parseTimestamp("01:02:03.004"), 3723.004);
  assert.equal(P.parseTimestamp("02:03.5"), 123.5);
  assert.ok(Number.isNaN(P.parseTimestamp("nope")));
});

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello, <i>there</i>

2
00:00:03,000 --> 00:00:04,000
Second line
`;
test("srt: numbered blocks with comma timestamps", () => {
  const cues = P.parseSrt(SRT);
  assert.deepEqual(
    cues.map((c) => [r3(c.start), r3(c.end), c.text]),
    [
      [1, 2.5, "Hello, there"],
      [3, 4, "Second line"]
    ]
  );
});
test("parseSubtitleText: picks srt vs vtt from hint/body", () => {
  assert.equal(P.parseSubtitleText(SRT, "movie.en.srt").length, 2);
  assert.equal(P.parseSubtitleText("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n", "x.vtt")[0].text, "Hi");
});

test("json3 words: karaoke timings from segs", () => {
  const cues = P.parseJson3({
    events: [
      {
        tStartMs: 1000,
        dDurationMs: 2000,
        segs: [
          { utf8: "Hello", tOffsetMs: 0 },
          { utf8: " ", tOffsetMs: 400 },
          { utf8: "world", tOffsetMs: 500 }
        ]
      }
    ]
  });
  assert.equal(cues.length, 1);
  assert.ok(cues[0].words && cues[0].words.length >= 2);
  assert.equal(P.activeWordIndex(cues[0].words, 1.1) >= 0, true);
});

// ---------------------------------------------------------------- CC cleanup
test("cleanCC: sound tags, parentheticals, speaker labels", () => {
  assert.equal(P.cleanCC("[door creaks]"), "");
  assert.equal(P.cleanCC("(laughs) You got me."), "You got me.");
  assert.equal(P.cleanCC("JOHN: Where are you going?"), "Where are you going?");
  assert.equal(P.cleanCC("- [door creaks] - JOHN: Who's there? (laughs)"), "- Who's there?");
  assert.equal(P.cleanCC("- MARY JANE: Hi. - DR. SMITH: Bye."), "- Hi. - Bye.");
  assert.equal(P.cleanCC("It's 10:30 now. I said: no"), "It's 10:30 now. I said: no");
  assert.equal(P.cleanCC("♪ la la ♪"), "la la");
  assert.equal(P.cleanCC("（笑）そうですね"), "そうですね");
});

// ---------------------------------------------------------------- alignment
test("align: same timing (tlang) → index match", () => {
  const en = [{ start: 0, end: 1, text: "a" }, { start: 1, end: 2, text: "b" }];
  const ko = [{ start: 0, end: 1, text: "가" }, { start: 1, end: 2, text: "나" }];
  const out = P.alignCues(en, ko, true);
  assert.deepEqual(out.map((c) => c.nat), ["가", "나"]);
  assert.deepEqual(out.map((c) => c.src), ["a", "b"]);
});
test("align: by time overlap; joins native cues mostly inside; empty when none", () => {
  const en = [
    { start: 0, end: 3, text: "one" },
    { start: 3, end: 6, text: "two" },
    { start: 10, end: 12, text: "three" }
  ];
  const ko = [
    { start: 0.1, end: 1.4, text: "하나a" },
    { start: 1.5, end: 3.2, text: "하나b" },
    { start: 3.3, end: 5.9, text: "둘" },
    { start: 20, end: 21, text: "외톨이" }
  ];
  assert.deepEqual(P.alignCues(en, ko).map((c) => c.nat), ["하나a 하나b", "둘", ""]);
});
test("align: native cue spanning two cues goes to the bigger overlap for each", () => {
  const en = [{ start: 0, end: 2, text: "x" }, { start: 2, end: 6, text: "y" }];
  const ko = [{ start: 0.5, end: 5.5, text: "긴 자막" }];
  assert.deepEqual(P.alignCues(en, ko).map((c) => c.nat), ["긴 자막", "긴 자막"]);
});

// ---------------------------------------------------------------- languages
test("baseLang / sameLang: regions, scripts, legacy codes", () => {
  assert.equal(P.baseLang("en-US"), "en");
  assert.equal(P.baseLang("zh-Hans"), "zh");
  assert.equal(P.baseLang("zh_CN"), "zh");
  assert.equal(P.baseLang("pt-BR"), "pt");
  assert.equal(P.baseLang("iw"), "he");
  assert.equal(P.baseLang(""), "");
  assert.ok(P.sameLang("pt-BR", "pt"));
  assert.ok(P.sameLang("en-GB", "en"));
  assert.ok(!P.sameLang("en", "es"));
  assert.ok(!P.sameLang("", ""));
});

// ---------------------------------------------------------------- tokenizer
function words(s, lang) { return P.tokenize(s, lang || "en").filter((t) => t.w).map((t) => t.text); }
test("tokenize en: contractions, abbreviations, numbers, em-dash", () => {
  assert.deepEqual(words("Don't worry, it's fine."), ["Don't", "worry", "it's", "fine"]);
  assert.deepEqual(words("The U.S. economy grew 3.5% in 2024—a record."), ["The", "U.S.", "economy", "grew", "3.5", "in", "2024", "a", "record"]);
  assert.deepEqual(words("I’m here — at 10:30, with 1,000 people"), ["I’m", "here", "at", "10:30", "with", "1,000", "people"]);
  assert.deepEqual(words("naïve café"), ["naïve", "café"]);
});
test("tokenize es: inverted punctuation, accents", () => {
  assert.deepEqual(words("¿Qué estás comiendo, señor?", "es"), ["Qué", "estás", "comiendo", "señor"]);
});
test("tokenize ja: no spaces → dictionary words", () => {
  assert.deepEqual(words("私は毎日ご飯を食べる。", "ja"), ["私", "は", "毎日", "ご飯", "を", "食べる"]);
});
test("tokenize zh: no spaces → dictionary words", () => {
  assert.deepEqual(words("我今天去学校了。", "zh"), ["我", "今天", "去", "学校", "了"]);
});
test("tokenize ko: space-separated words keep their particles", () => {
  assert.deepEqual(words("저는 학교에 갑니다. TED 강연", "ko"), ["저는", "학교에", "갑니다", "TED", "강연"]);
});
test("tokenize: tokens cover the string exactly (en/ja)", () => {
  for (const [s, lang] of [["Well—maybe... (not) 'quoted' U.S.A.!", "en"], ["「今日は、いい天気ですね！」と言った。", "ja"]]) {
    const toks = P.tokenize(s, lang);
    assert.equal(toks.map((t) => t.text).join(""), s);
    toks.forEach((t) => assert.equal(s.slice(t.start, t.end), t.text));
    for (let i = 1; i < toks.length; i++) assert.ok(toks[i].w || toks[i - 1].w, "adjacent separators are merged");
  }
});

// ---------------------------------------------------------------- cue search
test("findCue / floorCue", () => {
  const cues = [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 4, end: 6 }];
  assert.equal(P.findCue(cues, 0.5), -1);
  assert.equal(P.findCue(cues, 1.5), 0);
  assert.equal(P.findCue(cues, 2.5), -1);
  assert.equal(P.floorCue(cues, 2.5), 0);
  assert.equal(P.findCue(cues, 4), 2);
  assert.equal(P.findCue(cues, 7), -1);
  assert.equal(P.floorCue(cues, 7), 2);
});

// ---------------------------------------------------------------- YouTube track plan
const T = (languageCode, kind, extra) => ({ baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=" + languageCode, languageCode, kind: kind || "", name: languageCode, ...extra });
test("planYoutubeTracks: learn ko / native en with manual tracks → both official", () => {
  const p = P.planYoutubeTracks([T("en", "asr"), T("ko"), T("en-US"), T("ko", "asr")], { learn: "ko", native: "en", allowMT: true });
  assert.equal(p.learnLang, "ko");
  assert.equal(p.learn.languageCode, "ko");
  assert.equal(p.learn.kind, "");
  assert.equal(p.native.track.languageCode, "en-US");
  assert.equal(p.native.kind, "official");
  assert.equal(p.native.tlang, "");
  assert.equal(p.same, false);
});
test("planYoutubeTracks: auto = ASR language; English video for an English user → one line", () => {
  const p = P.planYoutubeTracks([T("en", "asr"), T("en"), T("ko")], { learn: "auto", native: "en" });
  assert.equal(p.learnLang, "en");
  assert.equal(p.learn.kind, "");
  assert.equal(p.same, true);
  assert.equal(p.native, null);
});
test("planYoutubeTracks: auto without ASR → first manual track not in native language", () => {
  const p = P.planYoutubeTracks([T("en"), T("fr"), T("de")], { learn: "auto", native: "en" });
  assert.equal(p.learnLang, "fr");
  assert.equal(p.native.kind, "official");
});
test("planYoutubeTracks: no native track → tlang MT (zh uses zh-Hans); MT disabled → none", () => {
  const p = P.planYoutubeTracks([T("es", "asr"), T("es-419")], { learn: "auto", native: "zh", allowMT: true });
  assert.equal(p.learn.languageCode, "es-419");
  assert.equal(p.native.kind, "mt");
  assert.equal(p.native.tlang, "zh-Hans");
  assert.equal(p.native.track, p.learn);
  assert.equal(P.planYoutubeTracks([T("es", "asr")], { learn: "auto", native: "en", allowMT: false }).native, null);
});
test("planYoutubeTracks: native ASR preferred over MT", () => {
  const p = P.planYoutubeTracks([T("en", "asr"), T("ko")], { learn: "ko", native: "en", allowMT: true });
  assert.equal(p.native.kind, "asr");
});
test("planYoutubeTracks: requested language missing → falls back to the video language, reports missing", () => {
  const p = P.planYoutubeTracks([T("en", "asr"), T("en"), T("ko")], { learn: "es", native: "en", allowMT: true });
  assert.equal(p.missing, "es");
  assert.equal(p.learnLang, "en");
  assert.equal(p.same, true);
  const q = P.planYoutubeTracks([T("en", "asr"), T("en"), T("ko")], { learn: "es", native: "ko", allowMT: true });
  assert.equal(q.missing, "es");
  assert.equal(q.learnLang, "en");
  assert.equal(q.native.kind, "official");
  assert.equal(P.planYoutubeTracks([], { learn: "auto", native: "en" }).learn, null);
});
test("buildTimedTextUrl: fmt/c/tlang/pot", () => {
  const u = new URL(P.buildTimedTextUrl("https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=srv3", { tlang: "ko", pot: "TOK" }));
  assert.equal(u.searchParams.get("fmt"), "json3");
  assert.equal(u.searchParams.get("c"), "WEB");
  assert.equal(u.searchParams.get("tlang"), "ko");
  assert.equal(u.searchParams.get("pot"), "TOK");
  const u2 = new URL(P.buildTimedTextUrl("/api/timedtext?v=abc&lang=en", {}));
  assert.equal(u2.searchParams.get("pot"), null);
  assert.equal(u2.origin, "https://www.youtube.com");
});
test("simplifyYoutubeTrack: simpleText / runs", () => {
  assert.equal(P.simplifyYoutubeTrack({ baseUrl: "u", languageCode: "en", name: { simpleText: "English" } }).name, "English");
  assert.equal(P.simplifyYoutubeTrack({ baseUrl: "u", languageCode: "ko", kind: "asr", name: { runs: [{ text: "Korean (auto)" }] } }).name, "Korean (auto)");
});

// ---------------------------------------------------------------- Netflix manifest
const NEW_SHAPE = {
  id: 123,
  result: {
    movieId: 81234567,
    duration: 3600000,
    textTracks: [
      { id: "T:1:0;1;en;0;0;0;", language: "en", languageDescription: "English (CC)", rawTrackType: "closedcaptions", isForcedNarrative: false, isNoneTrack: false,
        downloadables: { "webvtt-lssdh-ios8": { urls: [{ url: "https://ipv4-c001.nflxvideo.net/?o=1&v=en-cc", cdnId: 1 }] }, "imsc1.1": { urls: [{ url: "x" }] } } },
      { id: "T:2:0;1;en;1;0;0;", language: "en", languageDescription: "English", rawTrackType: "subtitles", isForcedNarrative: false, isNoneTrack: false,
        downloadables: { "webvtt-lssdh-ios8": { urls: [{ url: "https://ipv4-c001.nflxvideo.net/?o=1&v=en-sub" }] } } },
      { id: "T:3", language: "en", languageDescription: "English (forced)", rawTrackType: "subtitles", isForcedNarrative: true, isNoneTrack: false, downloadables: {} },
      { id: "T:4", language: "ko", languageDescription: "Korean", rawTrackType: "subtitles", isForcedNarrative: false, isNoneTrack: false,
        downloadables: { "webvtt-lssdh-ios8": { urls: [{ url: "https://ipv4-c001.nflxvideo.net/?o=1&v=ko" }] } } },
      { id: "T:off", language: null, isNoneTrack: true, downloadables: null }
    ]
  }
};
const OLD_SHAPE = {
  version: 2,
  result: {
    movieId: "70001",
    timedtexttracks: [
      { new_track_id: "old-en", language: "en", languageDescription: "English", rawTrackType: "subtitles", isForcedNarrative: false, isNoneTrack: false,
        ttDownloadables: { "webvtt-lssdh-ios8": { downloadUrls: { 12: "https://oca.nflxvideo.net/old-en.vtt" } } } },
      { new_track_id: "old-none", isNoneTrack: true, ttDownloadables: {} }
    ]
  }
};
test("netflix manifest: new shape (textTracks / downloadables / urls[0].url / id)", () => {
  const raw = JSON.stringify(NEW_SHAPE);
  assert.ok(P.mayCarryNetflixTracks(raw));
  const m = P.extractNetflixManifest(JSON.parse(raw));
  assert.equal(m.movieId, "81234567");
  assert.equal(m.tracks.length, 5);
  assert.equal(m.tracks[0].id, "T:1:0;1;en;0;0;0;");
  assert.equal(m.tracks[0].url, "https://ipv4-c001.nflxvideo.net/?o=1&v=en-cc");
  assert.equal(m.tracks[4].isNoneTrack, true);
  const pick = P.pickNetflixTracks(m.tracks, { learn: "en", native: "ko" });
  assert.equal(pick.learn.id, "T:2:0;1;en;1;0;0;"); // subtitles preferred over closedcaptions
  assert.equal(pick.native.url, "https://ipv4-c001.nflxvideo.net/?o=1&v=ko");
  const auto = P.pickNetflixTracks(m.tracks, { learn: "auto", native: "ko" });
  assert.equal(auto.learnLang, "en"); // first non-forced track that isn't native
  const same = P.pickNetflixTracks(m.tracks, { learn: "auto", native: "en", original: "en" });
  assert.equal(same.same, true);
  assert.equal(same.native, null);
  const ko = P.pickNetflixTracks(m.tracks, { learn: "auto", native: "en", original: "ko" });
  assert.equal(ko.learnLang, "ko");
  assert.equal(ko.native.id, "T:2:0;1;en;1;0;0;");
  const miss = P.pickNetflixTracks(m.tracks, { learn: "ja", native: "ko" });
  assert.equal(miss.missing, "ja");
  assert.equal(miss.learnLang, "en");
});
test("netflix manifest: original audio language (isNative / [Original])", () => {
  const withAudio = { result: { ...NEW_SHAPE.result, audioTracks: [
    { language: "en", languageDescription: "English", isNative: false },
    { language: "ja", languageDescription: "Japanese [Original]" }
  ] } };
  assert.equal(P.extractNetflixManifest(withAudio).original, "ja");
  assert.equal(P.extractNetflixManifest(NEW_SHAPE).original, "");
});
test("netflix manifest: old shape (timedtexttracks / ttDownloadables / downloadUrls / new_track_id)", () => {
  const m = P.extractNetflixManifest(OLD_SHAPE);
  assert.equal(m.movieId, "70001");
  assert.equal(m.tracks[0].id, "old-en");
  assert.equal(m.tracks[0].url, "https://oca.nflxvideo.net/old-en.vtt");
  const pick = P.pickNetflixTracks(m.tracks, { learn: "en", native: "ko" });
  assert.equal(pick.learn.id, "old-en");
  assert.equal(pick.native, null);
});
test("netflix manifest: unrelated JSON → null, prefilter rejects", () => {
  assert.equal(P.extractNetflixManifest({ movieId: 1, foo: [1, 2] }), null);
  assert.equal(P.mayCarryNetflixTracks('{"a":1}'), false);
});
test("netflix request: profile injection + showAllSubDubTracks only on manifest requests", () => {
  const req = { version: 2, url: "licensedManifest", params: { profiles: ["heaac-2-dash", "playready-h264mpl30-dash"], showAllSubDubTracks: false, viewableId: 1 } };
  assert.equal(P.injectNetflixProfiles(req), true);
  assert.ok(req.params.profiles.includes("webvtt-lssdh-ios8"));
  assert.equal(req.params.showAllSubDubTracks, true);
  assert.equal(P.injectNetflixProfiles(req), false); // idempotent
  const other = { url: "/events", params: { profiles: ["a"] } };
  assert.equal(P.injectNetflixProfiles(other), false);
  assert.deepEqual(other.params.profiles, ["a"]);
});

test("cleanCC: all-caps phrase before a colon mid-line is kept", () => {
  assert.equal(P.cleanCC("SO HERE'S THE THING: YOU WAIT."), "SO HERE'S THE THING: YOU WAIT.");
  assert.equal(P.cleanCC("- JOHN: Hi. - MARY: Hey."), "- Hi. - Hey.");
});

test("fixCaseLines: all-caps track → sentence case, normal track untouched", () => {
  const caps = ["BUT THEN THOSE MIDDLE MONTHS ACTUALLY WENT BY,", "AND I DIDN'T REALLY WRITE WORDS.", "I'M WATCHING TV. OK?", "WHAT'S NEXT"];
  assert.deepEqual(P.fixCaseLines(caps), [
    "But then those middle months actually went by,",
    "and I didn't really write words.",
    "I'm watching TV. OK?",
    "What's next",
  ]);
  const normal = ["But then those middle months actually went by,", "NASA said OK."];
  assert.deepEqual(P.fixCaseLines(normal), normal);
  // Non-Latin track with acronyms: untouched.
  const ko = ["TED 강연에서 NASA와 FBI 이야기를 했습니다", "AI와 DNA, USB 그리고 CPU 얘기도 나왔습니다 정말 많이요"];
  assert.deepEqual(P.fixCaseLines(ko), ko);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
