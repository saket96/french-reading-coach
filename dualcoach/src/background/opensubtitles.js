// OpenSubtitles.com REST API (https://api.opensubtitles.com/api/v1).
// User supplies their own API key (free consumer key from opensubtitles.com).

const API = "https://api.opensubtitles.com/api/v1";
const APP_NAME = "DualCoach";

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

async function osFetch(path, { apiKey, method = "GET", body, token } = {}) {
  if (!apiKey) throw new Error("Add an OpenSubtitles API key in Settings");
  const headers = {
    Accept: "application/json",
    "Api-Key": apiKey,
    "Content-Type": "application/json",
    // Chrome forbids overriding User-Agent; OpenSubtitles accepts this app header.
    "X-User-Agent": `${APP_NAME} ${chrome.runtime.getManifest().version}`
  };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, {
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
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

/**
 * Search subtitles by movie/series title.
 * @returns {{ results: Array<{id,fileId,language,title,release,downloads,hearingImpaired}> }}
 */
export async function searchSubtitles({ apiKey, query, languages, season, episode, token }) {
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

  const data = await osFetch("/subtitles?" + canonicalQuery(params), { apiKey, token });
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

/** Request a temporary download URL, then fetch subtitle file text. */
export async function downloadSubtitle({ apiKey, fileId, token }) {
  const id = Number(fileId);
  if (!id) throw new Error("Missing subtitle file id");
  const meta = await osFetch("/download", {
    apiKey,
    token,
    method: "POST",
    body: { file_id: id }
  });
  const link = meta && meta.link;
  if (!link) throw new Error("OpenSubtitles did not return a download link (quota?)");
  const res = await fetch(link, { redirect: "follow" });
  if (!res.ok) throw new Error("Subtitle download failed (" + res.status + ")");
  const buf = await res.arrayBuffer();
  // Try UTF-8, fall back to latin1 for older SRT files
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("\uFFFD")) {
    text = new TextDecoder("iso-8859-1").decode(buf);
  }
  // Strip UTF-8 BOM
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
  return { ok: true, count: out.results.length };
}

export { baseLang as osBaseLang };
