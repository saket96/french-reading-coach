// LLM providers for in-context meaning. Raw HTTP: the extension ships no npm deps.

const TIMEOUT_MS = 15000;

function systemPrompt(learnName, nativeName) {
  return `You help a native ${nativeName} speaker who is learning ${learnName} understand subtitles.
You get an expression the user selected and the subtitle sentence it appeared in.
Explain what the expression means in that sentence. Write every field in ${nativeName}.
Output only this JSON:
{"meaning": "the meaning in context, short and natural (a few words)", "explanation": "1-2 sentences on nuance and usage; say so if it is an idiom, phrasal verb, slang, jargon or abbreviation", "literal": "a literal translation only if it differs from meaning, else an empty string"}`;
}

function userContent(text, context, learnName) {
  return `Language: ${learnName}\nExpression: "${text}"\nSentence: "${context || text}"`;
}

/** Pull a JSON object out of a model response that may be fenced or padded with prose. */
export function extractJson(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("The AI returned an empty response");
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(s);
  } catch (_) {
    /* fall through to brace scan */
  }
  const start = s.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch (_) {
          break;
        }
      }
    }
  }
  throw new Error("Couldn't read the AI response");
}

function httpMessage(status) {
  if (status === 400 || status === 401 || status === 403) return "Check your API key";
  if (status === 429) return "Rate limit reached. Try again in a moment";
  if (status >= 500) return "The AI service is having trouble. Try again later";
  return "Request failed (" + status + ")";
}

async function postJson(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(httpMessage(res.status));
    return await res.json();
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("The AI took too long to answer. Try again");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini({ system, user, apiKey, model }) {
  const m = model || "gemini-2.5-flash-lite";
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        responseMimeType: "application/json"
      }
    }
  );
  let out = "";
  try {
    out = json.candidates[0].content.parts[0].text;
  } catch (_) {
    throw new Error("Couldn't read the AI response");
  }
  return { parsed: extractJson(out), model: m };
}

async function callAnthropic({ system, user, apiKey, model }) {
  const m = model || "claude-haiku-4-5";
  const json = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    {
      model: m,
      max_tokens: 400,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }]
    }
  );
  let out = "";
  try {
    out = (json.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
  } catch (_) {
    out = "";
  }
  if (!out) throw new Error("Couldn't read the AI response");
  return { parsed: extractJson(out), model: m };
}

/** OpenRouter (OpenAI-compatible). Prefer models ending in `:free` for the free tier. */
async function callOpenRouter({ system, user, apiKey, model }) {
  const m = model || "meta-llama/llama-3.3-70b-instruct:free";
  const json = await postJson(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": "https://github.com/saket96/french-reading-coach",
      "X-Title": "DualCoach"
    },
    {
      model: m,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    }
  );
  let out = "";
  try {
    out = json.choices[0].message.content;
  } catch (_) {
    out = "";
  }
  if (!out) {
    const errMsg = json && json.error && json.error.message ? String(json.error.message) : "";
    throw new Error(errMsg || "Couldn't read the AI response");
  }
  return { parsed: extractJson(out), model: m };
}

/**
 * Explain `text` as used in `context`, written in the user's language.
 * learnName / nativeName are English language names ("Spanish", "Korean").
 * Returns {meaning, explanation, literal, model}; throws Error with a user-facing message.
 */
export async function llmExplain({ text, context, learnName, nativeName, provider, apiKey, model }) {
  if (!apiKey) throw new Error("No API key set");
  const fn =
    provider === "anthropic"
      ? callAnthropic
      : provider === "openrouter"
        ? callOpenRouter
        : callGemini;
  const learn = learnName || "the original language";
  const { parsed, model: used } = await fn({
    system: systemPrompt(learn, nativeName || "English"),
    user: userContent(text, context, learn),
    apiKey,
    model
  });

  const meaning = String((parsed && parsed.meaning) || "").trim();
  const explanation = String((parsed && parsed.explanation) || "").trim();
  let literal = String((parsed && parsed.literal) || "").trim();
  if (literal && literal === meaning) literal = "";
  if (!meaning && !explanation) throw new Error("Couldn't read the AI response");
  return { meaning, explanation, literal, model: used };
}
