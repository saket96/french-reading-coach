// Lookup cache on chrome.storage.local. One key per entry + an LRU index.

const PREFIX = "c:";
const INDEX = "cacheIndex";
const MAX_ENTRIES = 3000;
const EVICT_BATCH = 300;

export const DAY = 24 * 60 * 60 * 1000;
export const TTL_DICT = 30 * DAY;
export const TTL_LLM = 90 * DAY;

// djb2-ish string hash -> short base36, used to key phrase+context pairs.
export function shortHash(str) {
  let h = 5381;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function readIndex() {
  const got = await chrome.storage.local.get(INDEX);
  return Array.isArray(got && got[INDEX]) ? got[INDEX] : [];
}

export async function cacheGet(key) {
  const k = PREFIX + key;
  let got;
  try {
    got = await chrome.storage.local.get(k);
  } catch (_) {
    return null;
  }
  const rec = got && got[k];
  if (!rec || typeof rec !== "object") return null;
  if (typeof rec.t !== "number" || typeof rec.ttl !== "number") return null;
  if (Date.now() - rec.t > rec.ttl) {
    chrome.storage.local.remove(k).catch(() => {});
    return null;
  }
  return rec.v;
}

export async function cacheSet(key, value, ttl) {
  const k = PREFIX + key;
  try {
    await chrome.storage.local.set({ [k]: { v: value, t: Date.now(), ttl: ttl || TTL_LLM } });
  } catch (_) {
    return;
  }
  // Maintain LRU order: most recent last.
  let index = await readIndex();
  const at = index.indexOf(key);
  if (at !== -1) index.splice(at, 1);
  index.push(key);
  if (index.length > MAX_ENTRIES) {
    const dead = index.splice(0, EVICT_BATCH);
    await chrome.storage.local.remove(dead.map((d) => PREFIX + d)).catch(() => {});
  }
  await chrome.storage.local.set({ [INDEX]: index }).catch(() => {});
}

export async function cacheClear() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX) || k === INDEX);
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.filter((k) => k !== INDEX).length;
}
