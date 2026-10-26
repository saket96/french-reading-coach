// OpenSubtitles.com REST API (https://api.opensubtitles.com/api/v1).
// Search works with Api-Key alone; /download requires Api-Key + Bearer JWT from /login.

const API_DEFAULT = "https://api.opensubtitles.com/api/v1";
const APP_NAME = "DualCoach";
const TOKEN_KEY = "opensubtitlesToken";
const BASE_KEY = "opensubtitlesBaseUrl";
const USER_KEY = "opensubtitlesUsername";
const PASS_KEY = "opensubtitlesPassword";

function appAgent() {
  try {
    return `${APP_NAME} v${chrome.runtime.getManifest().version}`;
  } catch (_) {
    return `${APP_NAME} v0`;
  }
}

function baseLang(code) {
  const c = String(code || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!c || c === "auto") return "";
  return c.split("-")[0];
}

/** Build canonical query string: sorted keys, lowercase values, spaces as +. */
function canonicalQuery(params) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [k, String(v).trim().toLowerCase().replace(/\s+/g, " ")]);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v).replace(/%20/g, "+"))
    .join("&");
}

function apiRoot(baseHost) {
  const host = String(baseHost || "api.opensubtitles.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/api/v1`;
}

async function osFetch(path, { apiKey, method = "GET", body, token, baseUrl } = {}) {
  if (!apiKey) throw new Error("Add an OpenSubtitles API key in Settings");
  const headers = {
    Accept: "application/json",
    "Api-Key": apiKey,
    "Content-Type": "application/json",
    // Chrome forbids overriding User-Agent; OpenSubtitles also reads these.
    "X-User-Agent": appAgent(),
    "User-Agent": appAgent()
  };
  if (token) headers.Authorization = "Bearer " + token;
  const root = apiRoot(baseUrl);
  const res = await fetch(root + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "follow"
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || data.errors)) ||
      "OpenSubtitles HTTP " + res.status;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function getStoredOsAuth() {
  const got = await chrome.storage.local.get([TOKEN_KEY, BASE_KEY, USER_KEY, PASS_KEY]);
  return {
    token: (got[TOKEN_KEY] || "").trim(),
    baseUrl: (got[BASE_KEY] || "").trim(),
    username: (got[USER_KEY] || "").trim(),
    password: got[PASS_KEY] ? String(got[PASS_KEY]) : ""
  };
}

export async function setStoredOsCredentials(username, password) {
  const u = String(username || "").trim();
  const p = String(password || "");
  const patch = {};
  if (u) patch[USER_KEY] = u;
  else await chrome.storage.local.remove(USER_KEY);
  if (p) patch[PASS_KEY] = p;
  else await chrome.storage.local.remove(PASS_KEY);
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  // Force re-login next time
  await chrome.storage.local.remove([TOKEN_KEY, BASE_KEY]);
}

async function saveSession(token, baseUrl) {
  await chrome.storage.local.set({
    [TOKEN_KEY]: token,
    [BASE_KEY]: baseUrl || "api.opensubtitles.com"
  });
}

export async function clearOsSession() {
  await chrome.storage.local.remove([TOKEN_KEY, BASE_KEY]);
}

/** POST /login — required before /download (API returns "missing token" without Bearer). */
export async function loginOpenSubtitles({ apiKey, username, password }) {
  const user = String(username || "").trim();
  const pass = String(password || "");
  if (!user || !pass) {
    throw new Error("Add your OpenSubtitles username and password in Settings (needed to download)");
  }
  const data = await osFetch("/login", {
    apiKey,
    method: "POST",
    body: { username: user, password: pass }
  });
  const token = data && data.token;
  if (!token) throw new Error("OpenSubtitles login did not return a token");
  const baseUrl = (data.base_url || "api.opensubtitles.com").replace(/^https?:\/\//, "");
  await saveSession(token, baseUrl);
  return {
    token,
    baseUrl,
    allowedDownloads: data.user && data.user.allowed_downloads
  };
}

/** Ensure we have a Bearer token; login if needed. */
export async function ensureOsToken(apiKey) {
  const auth = await getStoredOsAuth();
  if (auth.token) return auth;
  if (!auth.username || !auth.password) {
    throw new Error(
      "missing token — add OpenSubtitles username + password in Settings, then retry (downloads need login)"
    );
  }
  const session = await loginOpenSubtitles({
    apiKey,
    username: auth.username,
    password: auth.password
  });
  return { token: session.token, baseUrl: session.baseUrl, username: auth.username, password: auth.password };
}

/**
 * Search subtitles by movie/series title.
 * @returns {{ results: Array<{id,fileId,language,title,release,downloads,hearingImpaired}> }}
 */
export async function searchSubtitles({ apiKey, query, languages, season, episode, token, baseUrl }) {
  const q = String(query || "").trim();
  if (q.length < 2) throw new Error("Enter a movie or series title");

  const langs = (Array.isArray(languages) ? languages : String(languages || "").split(","))
    .map(baseLang)
    .filter(Boolean);
  const uniq = [...new Set(langs)];
  if (!uniq.length) uniq.push("en");

  const params = {
    languages: uniq.sort().join(","),
    query: q,
    order_by: "download_count",
    order_direction: "desc"
  };
  if (season != null && season !== "") params.season_number = String(season);
  if (episode != null && episode !== "") params.episode_number = String(episode);

  const data = await osFetch("/subtitles?" + canonicalQuery(params), { apiKey, token, baseUrl });
  const rows = Array.isArray(data && data.data) ? data.data : [];
  const results = [];
  for (const row of rows) {
    const attr = row.attributes || {};
    const files = Array.isArray(attr.files) ? attr.files : [];
    const file = files[0];
    if (!file || file.file_id == null) continue;
    const feat = attr.feature_details || {};
    results.push({
      id: String(row.id || file.file_id),
      fileId: Number(file.file_id),
      language: baseLang(attr.language) || "",
      title: feat.movie_name || feat.title || attr.release || q,
      release: attr.release || file.file_name || "",
      downloads: Number(attr.download_count) || 0,
      hearingImpaired: !!attr.hearing_impaired,
      year: feat.year || null,
      season: feat.season_number ?? null,
      episode: feat.episode_number ?? null
    });
  }
  return { results, total: Number(data && data.total_count) || results.length };
}

/** Request a temporary download URL, then fetch subtitle file text. Needs Bearer token. */
export async function downloadSubtitle({ apiKey, fileId, token, baseUrl }) {
  const id = Number(fileId);
  if (!id) throw new Error("Missing subtitle file id");

  let authToken = token;
  let host = baseUrl;
  if (!authToken) {
    const session = await ensureOsToken(apiKey);
    authToken = session.token;
    host = session.baseUrl;
  }

  let meta;
  try {
    meta = await osFetch("/download", {
      apiKey,
      token: authToken,
      baseUrl: host,
      method: "POST",
      body: { file_id: id }
    });
  } catch (e) {
    const msg = String((e && e.message) || "");
    // Token expired / missing — clear and retry login once
    if (/token|unauthorized|401|403/i.test(msg)) {
      await clearOsSession();
      const session = await ensureOsToken(apiKey);
      meta = await osFetch("/download", {
        apiKey,
        token: session.token,
        baseUrl: session.baseUrl,
        method: "POST",
        body: { file_id: id }
      });
    } else {
      throw e;
    }
  }

  const link = meta && meta.link;
  if (!link) throw new Error("OpenSubtitles did not return a download link (quota?)");
  const res = await fetch(link, { redirect: "follow" });
  if (!res.ok) throw new Error("Subtitle download failed (" + res.status + ")");
  const buf = await res.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("\uFFFD")) {
    text = new TextDecoder("iso-8859-1").decode(buf);
  }
  text = text.replace(/^\uFEFF/, "");
  return {
    text,
    fileName: (meta && meta.file_name) || "",
    remaining: meta && meta.remaining,
    resetIn: meta && meta.reset_time_utc
  };
}

export async function testOpenSubtitles(apiKey) {
  const out = await searchSubtitles({ apiKey, query: "matrix", languages: ["en"] });
  let loginOk = false;
  let loginError = "";
  try {
    const auth = await getStoredOsAuth();
    if (auth.username && auth.password) {
      await loginOpenSubtitles({ apiKey, username: auth.username, password: auth.password });
      loginOk = true;
    }
  } catch (e) {
    loginError = e && e.message ? e.message : "login failed";
  }
  return {
    ok: true,
    count: out.results.length,
    loginOk,
    loginError: loginOk ? "" : loginError || "Add username + password to enable downloads"
  };
}

export { baseLang as osBaseLang, API_DEFAULT };
