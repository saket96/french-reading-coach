// Word/phrase card: Wiktionary → LLM (optional) → Chrome built-in Translator.
(function () {
  "use strict";
  var DC = window.DC;
  var esc = DC.esc;
  var SVG = DC.SVG;
  var LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
  var AI_HINT = "Add an AI key in Settings for explanations in context.";

  var wrap = null;   // positioned container (inside the overlay shadow root)
  var cardEl = null; // .card
  var state = null;  // {text, context, contextNative, lang, native, isWord, reqId, data, expanded, ctxState, gloss, place, onClose, meta}
  var reqSeq = 0;
  var translators = {}; // "es>en" → Promise<Translator>

  function normalizeText(raw) {
    var s = String(raw || "").replace(/\s+/g, " ").trim();
    s = s.replace(/^[\s"'`‘’“”«»„(\[{<.,;:!?¿¡—–\-「」『』（）【】、。，：；！？…]+/, "");
    s = s.replace(/[\s"'`‘’“”«»„)\]}>,;:!?¿¡—–「」『』（）【】、。，：；！？…]+$/, "");
    if (!/^(?:\p{Lu}\.){2,}$/u.test(s)) s = s.replace(/\.+$/, "");
    return s.trim();
  }

  function langName(code) { return DC.langName(code) || "this language"; }
  function needsGloss() { return !!state && DC.P.baseLang(state.native) !== "en" && !DC.P.sameLang(state.lang, state.native); }

  // ---------------------------------------------------------------- placement

  // place = {root, anchor:{left,top,right,bottom} relative to root, mode:"above"|"left"}
  function position() {
    if (!wrap || !state || !state.place) return;
    var p = state.place;
    var rw = p.root.clientWidth, rh = p.root.clientHeight;
    var w = Math.min(340, rw - 16);
    var a = p.anchor;
    wrap.style.width = w + "px";
    if (p.mode === "left") {
      var maxH = Math.max(160, Math.min(380, rh - 16));
      cardEl.style.setProperty("--card-max", maxH + "px");
      var h = cardEl.offsetHeight || 200;
      var left = Math.max(8, a.left - w - 10);
      var top = Math.min(Math.max(8, a.top - 8), rh - h - 8);
      wrap.style.left = left + "px";
      wrap.style.top = Math.max(8, top) + "px";
      wrap.style.bottom = "";
    } else {
      var room = a.top - 16;
      cardEl.style.setProperty("--card-max", Math.max(140, Math.min(380, room)) + "px");
      var cx = (a.left + a.right) / 2;
      var l = Math.min(Math.max(8, cx - w / 2), rw - w - 8);
      wrap.style.left = Math.max(8, l) + "px";
      wrap.style.top = "";
      wrap.style.bottom = Math.max(8, rh - a.top + 8) + "px";
    }
  }

  function render(kind, html) {
    if (!wrap) return;
    state.kind = kind;
    cardEl.innerHTML = html;
    position();
  }

  // ---------------------------------------------------------------- rendering

  function headActions(saved) {
    return (
      '<div class="acts">' +
      '<button class="ib" data-act="speak" title="Listen" type="button">' + SVG.speaker + "</button>" +
      '<button class="ib' + (saved ? " on" : "") + '" data-act="vocab" title="' +
      (saved ? "Remove from vocabulary" : "Save to vocabulary") + '" type="button">' +
      (saved ? SVG.bookmarkOn : SVG.bookmark) + "</button>" +
      '<button class="ib" data-act="close" title="Close (Esc)" type="button">' + SVG.close + "</button>" +
      "</div>"
    );
  }

  function phraseHead(saved) {
    return '<div class="hd"><div class="hd-main"><div class="hw hw-phrase" lang="' + esc(state.lang || "") + '">' + esc(state.text) + "</div></div>" +
      headActions(saved) + "</div>";
  }

  function footer(src) {
    return '<div class="ft"><span class="ft-src">' + src + "</span>" +
      '<button data-act="options" type="button">Settings</button></div>';
  }

  // The subtitle line the expression came from, with the expression emphasised.
  function sentenceSection() {
    var s = state;
    if (!s.context) return "";
    var ctx = s.context;
    var i = ctx.toLowerCase().indexOf(s.text.toLowerCase());
    var hl = i === -1 ? esc(ctx) :
      esc(ctx.slice(0, i)) + "<b>" + esc(ctx.slice(i, i + s.text.length)) + "</b>" + esc(ctx.slice(i + s.text.length));
    return '<div class="sec"><div class="sec-t">Sentence</div><div class="sent" lang="' + esc(s.lang || "") + '">' + hl + "</div>" +
      (s.contextNative ? '<div class="sent-nat">' + esc(s.contextNative) + "</div>" : "") + "</div>";
  }

  function renderLoading() {
    state.repaint = renderLoading;
    render("loading", phraseHead(false) + '<div class="bd"><div class="sk"></div><div class="sk w80"></div><div class="sk w55"></div></div>');
  }

  function renderError(message, retryable) {
    state.repaint = function () { renderError(message, retryable); };
    render("error",
      phraseHead(false) +
      '<div class="bd"><div class="err"><span class="msg">' + esc(message || "Something went wrong") + "</span>" +
      (retryable === false ? "" : '<button class="btn" data-act="retry" type="button">Retry</button>') +
      "</div>" + sentenceSection() + "</div>" +
      footer("")
    );
  }

  function contextSection() {
    if (!DC.llmReady || DC.settings.contextMode === "off") return "";
    var c = state.ctxState;
    var inner;
    if (!c || c.status === "idle") {
      inner = '<button class="tbtn" data-act="ctx" type="button">Show meaning in context</button>';
    } else if (c.status === "loading") {
      inner = '<div class="sk"></div><div class="sk w80"></div>';
    } else if (c.status === "error") {
      inner = '<div class="err"><span class="msg">' + esc(c.error) + "</span>" +
        '<button class="btn" data-act="ctx" type="button">Retry</button></div>';
    } else {
      inner = (c.meaning ? '<div class="big">' + esc(c.meaning) + "</div>" : "") +
        (c.explanation ? '<div class="p">' + esc(c.explanation) + "</div>" : "");
    }
    return '<div class="sec"><div class="sec-t">Meaning in context</div>' + inner + "</div>";
  }

  function glossSection() {
    var g = state.gloss;
    if (!g || g.status === "none") return "";
    var inner = g.status === "done" ? '<div class="big">' + esc(g.text) + "</div>" :
      g.status === "loading" ? '<div class="sk w55"></div>' : '<div class="p msg">' + esc(g.text) + "</div>";
    return '<div class="gloss"><div class="sec-t">Translation · ' + esc(langName(state.native)) + "</div>" + inner + "</div>";
  }

  function renderDict() {
    var s = state, d = s.data;
    s.repaint = renderDict;
    var showAll = !!s.expanded;
    var entries = d.entries || [];
    var hasMore = false;
    var body = "";
    entries.forEach(function (ent) {
      var groups = ent.groups || [];
      var shown = showAll ? groups : groups.slice(0, 2);
      if (groups.length > shown.length) hasMore = true;
      var inner = "";
      shown.forEach(function (g) {
        var senses = showAll ? g.senses : g.senses.slice(0, 3);
        if (g.senses.length > senses.length || (g.example && !showAll)) hasMore = true;
        var mh = "";
        senses.forEach(function (m, i) {
          mh += '<div class="mean"><span class="num">' + (i + 1) + "</span><span>" + esc(m.text) + "</span></div>";
        });
        if (g.example && showAll) mh += '<div class="ex" lang="' + esc(s.lang || "") + '"><i>' + esc(g.example) + "</i></div>";
        inner += '<div class="grp">' + (g.pos ? '<div class="pos">' + esc(g.pos) + "</div>" : "") + mh + "</div>";
      });
      if (!inner) return;
      var label = entries.length > 1 && ent.headword ? '<div class="ent-hw">' + esc(ent.headword) + "</div>" : "";
      body += '<div class="ent">' + label + inner + "</div>";
    });
    if (hasMore) body += '<button class="more" data-act="more" type="button">' + (showAll ? "Less" : "More") + "</button>";

    var head = d.lemma || d.headword;
    var lemma = d.lemma
      ? '<div class="lemma">' + esc(s.text) + " → " + esc(d.lemma) + (d.formOf ? " · " + esc(d.formOf) : "") + "</div>" : "";
    var link = entries.length && entries[0].link ? entries[0].link : d.link;

    render("dict",
      '<div class="hd"><div class="hd-main"><div class="hw" lang="' + esc(s.lang || "") + '">' + esc(head) + "</div>" + lemma +
      "</div>" + headActions(d.saved) + "</div>" +
      '<div class="bd">' + glossSection() + body + contextSection() + sentenceSection() + "</div>" +
      footer('<a href="' + esc(link) + '" target="_blank" rel="noreferrer noopener">Wiktionary</a> · ' +
        '<a href="' + LICENSE_URL + '" target="_blank" rel="noreferrer noopener">CC BY-SA 4.0</a>')
    );
    if (DC.llmReady && DC.settings.contextMode === "auto" && !s.ctxState) loadContext();
  }

  function renderLlm() {
    var s = state, d = s.data;
    s.repaint = renderLlm;
    render("llm",
      phraseHead(d.saved) +
      '<div class="bd">' +
      (d.meaning ? '<div class="big">' + esc(d.meaning) + "</div>" : "") +
      (d.explanation ? '<div class="p">' + esc(d.explanation) + "</div>" : "") +
      (d.literal ? '<div class="lit">Literally: ' + esc(d.literal) + "</div>" : "") +
      sentenceSection() + "</div>" +
      footer(esc(d.model || "AI explanation"))
    );
  }

  function renderTranslated(text, note) {
    state.repaint = function () { renderTranslated(text, note); };
    render("translated",
      phraseHead(!!state.saved) +
      '<div class="bd"><div class="big">' + esc(text) + "</div>" +
      (note ? '<div class="p msg">' + esc(note) + "</div>" : "") + sentenceSection() + "</div>" +
      footer("Chrome built-in translation")
    );
  }

  function loadContext() {
    var s = state;
    var id = s.reqId;
    s.ctxState = { status: "loading" };
    renderDict();
    DC.send({ type: "context", text: s.text, context: s.context, lang: s.lang, native: s.native }).then(function (res) {
      if (!state || state.reqId !== id) return;
      if (!res) state.ctxState = { status: "error", error: "Reload the page to reconnect the extension" };
      else if (res.error) state.ctxState = { status: "error", error: res.error };
      else state.ctxState = { status: "done", meaning: res.meaning, explanation: res.explanation };
      renderDict();
    });
  }

  // ---------------------------------------------------------------- translator (on-device)

  // → Promise<Translator>; rejects with Error("unavailable") when the pair is not supported.
  async function getTranslator(src, tgt, onProgress) {
    if (!("Translator" in self)) throw new Error("unavailable");
    var key = src + ">" + tgt;
    var avail = await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
    if (["available", "downloadable", "downloading"].indexOf(avail) === -1) throw new Error("unavailable");
    if (avail !== "available" && onProgress) onProgress(0);
    if (!translators[key]) {
      translators[key] = self.Translator.create({
        sourceLanguage: src,
        targetLanguage: tgt,
        monitor: function (m) {
          m.addEventListener("downloadprogress", function (ev) { if (onProgress) onProgress(ev.loaded || 0); });
        }
      });
    }
    var waitMs = avail === "available" ? 15000 : 90000;
    try {
      return await Promise.race([
        translators[key],
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error("translator timeout")); }, waitMs); })
      ]);
    } catch (e) {
      delete translators[key];
      throw e;
    }
  }

  async function translate(text, onProgress) {
    var src = DC.P.baseLang(state.lang), tgt = DC.P.baseLang(state.native);
    var id = state.reqId;
    var t = await getTranslator(src, tgt, function (p) {
      if (!state || state.reqId !== id) return;
      if (onProgress) onProgress(p);
      else renderTranslated("Downloading the translation model… " + Math.round(p * 100) + "%", "This happens only once.");
    });
    return t.translate(text);
  }

  async function runGloss() {
    var id = state.reqId;
    state.gloss = { status: "loading" };
    try {
      var out = await translate(state.text, function (p) {
        state.gloss = { status: "note", text: "Downloading the translation model… " + Math.round(p * 100) + "%" };
        if (state.kind === "dict") renderDict();
      });
      if (!state || state.reqId !== id) return;
      state.gloss = { status: "done", text: out };
    } catch (e) {
      if (!state || state.reqId !== id) return;
      state.gloss = e && e.message === "unavailable"
        ? { status: "none" }
        : { status: "error", text: "Translation failed." };
    }
    if (state.kind === "dict") renderDict();
  }

  async function runTranslator(baseError) {
    var s = state;
    var id = s.reqId;
    var pair = langName(s.lang) + " → " + langName(s.native);
    if (DC.P.sameLang(s.lang, s.native)) {
      renderError((baseError ? baseError + " " : "") + "No dictionary entry found. " + AI_HINT, false);
      return;
    }
    try {
      var out = await translate(s.text);
      if (!state || state.reqId !== id) return;
      state.translated = out;
      renderTranslated(out, baseError || "");
      DC.send({ type: "isSaved", text: s.text, lang: s.lang }).then(function (res) {
        if (!state || state.reqId !== id || !res) return;
        state.saved = !!res.saved;
        if (state.repaint) state.repaint();
      });
    } catch (e) {
      if (!state || state.reqId !== id) return;
      if (e && e.message === "unavailable") {
        renderError((baseError ? baseError + " " : "") + "No dictionary entry, and translation " + pair +
          " isn't available in this browser. " + AI_HINT, false);
      } else {
        renderError("Translation failed. " + AI_HINT, true);
      }
    }
  }

  // ---------------------------------------------------------------- actions

  function firstSense(d) {
    try { return d.entries[0].groups[0].senses[0].text; } catch (_) { return ""; }
  }

  function toggleVocab() {
    var s = state, d = s.data || {};
    var meaning = "";
    if (d.kind === "dict") meaning = s.gloss && s.gloss.status === "done" ? s.gloss.text + " — " + firstSense(d) : firstSense(d);
    else if (d.kind === "llm") meaning = d.meaning || "";
    else if (s.translated) meaning = s.translated;
    var meta = s.meta || {};
    DC.send({
      type: "vocabToggle",
      item: {
        text: s.text,
        lemma: d.kind === "dict" ? d.lemma || "" : "",
        lang: s.lang || "",
        meaning: meaning,
        sentence: s.context || "",
        sentenceNative: s.contextNative || "",
        site: meta.site || "",
        title: meta.title || document.title,
        url: meta.url || location.href,
        time: meta.time || 0
      }
    }).then(function (res) {
      if (!res || !state) return;
      if (state.data) state.data.saved = !!res.saved;
      state.saved = !!res.saved;
      if (state.repaint) state.repaint();
    });
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!btn || !state) return;
    var act = btn.getAttribute("data-act");
    if (act === "close") close();
    else if (act === "speak") {
      var d = state.data;
      DC.send({ type: "speak", text: d && d.kind === "dict" ? d.lemma || d.headword : state.text, lang: state.lang });
    }
    else if (act === "vocab") toggleVocab();
    else if (act === "more") { state.expanded = !state.expanded; renderDict(); }
    else if (act === "ctx") loadContext();
    else if (act === "options") DC.send({ type: "openOptions" });
    else if (act === "retry") runLookup();
  }

  function runLookup() {
    var s = state;
    var id = ++reqSeq;
    s.reqId = id;
    s.data = null;
    s.expanded = false;
    s.ctxState = null;
    s.gloss = null;
    renderLoading();
    DC.send({ type: "lookup", text: s.text, context: s.context, isWord: s.isWord, lang: s.lang, native: s.native }).then(function (res) {
      if (!state || state.reqId !== id) return;
      if (!res) { renderError("Reload the page to reconnect the extension", false); return; }
      if (res.kind === "dict") {
        state.data = res;
        if (needsGloss()) runGloss();
        renderDict();
        return;
      }
      if (res.kind === "llm") { state.data = res; renderLlm(); return; }
      if (res.kind === "needTranslator") { runTranslator(res.error || ""); return; }
      renderError(res.error || "No meaning found");
    });
  }

  // ---------------------------------------------------------------- public

  function open(opts) {
    var text = normalizeText(opts.text);
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return false;
    close(true);
    wrap = document.createElement("div");
    wrap.className = "card-wrap";
    cardEl = document.createElement("div");
    cardEl.className = "card pm";
    // Inline paint beats any host-page translucency / missing stylesheet edge cases
    cardEl.style.cssText =
      "background-color:#fffaf2;color:#1f2a24;border:1px solid #d9cfc0;border-radius:12px;" +
      "box-shadow:0 12px 32px rgba(0,0,0,.45);opacity:1;mix-blend-mode:normal;overflow:hidden;";
    wrap.appendChild(cardEl);
    opts.layer.appendChild(wrap);
    wrap.addEventListener("click", onClick);
    state = {
      text: text,
      context: opts.context || "",
      contextNative: opts.contextNative || "",
      lang: opts.lang || "",
      native: opts.native || DC.settings.nativeLang || "en",
      isWord: !!opts.isWord && !/\s/.test(text),
      place: opts.place,
      onClose: opts.onClose,
      meta: opts.meta || {},
      reqId: 0
    };
    runLookup();
    return true;
  }

  function close(silent) {
    var cb = state && state.onClose;
    if (wrap) wrap.remove();
    wrap = null;
    cardEl = null;
    state = null;
    if (cb && !silent) {
      try { cb(); } catch (_) { /* ignore */ }
    }
  }

  DC.card = {
    open: open,
    close: function () { close(false); },
    isOpen: function () { return !!state; },
    contains: function (node) { return !!(wrap && node && wrap.contains(node)); },
    reposition: position,
    rerender: function () { if (state && state.repaint) state.repaint(); },
    // Test/debug hook: read-only.
    debug: function () {
      if (!state || !cardEl) return null;
      return {
        kind: state.kind || "",
        text: cardEl.textContent.replace(/\s+/g, " ").slice(0, 500),
        links: [].map.call(cardEl.querySelectorAll("a[href]"), function (a) { return a.href; }),
        gloss: state.gloss || null
      };
    }
  };
})();
