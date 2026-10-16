/** Lowercase and strip punctuation; keep French accents. */
export function tokenizeFrench(text) {
  if (!text) return []
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}
