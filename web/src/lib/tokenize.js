/** Normalize curly apostrophes to ASCII for stable matching. */
export function normalizeApostrophes(text) {
  return String(text ?? '').replace(/[\u2019\u2018\u02BC]/g, "'")
}

/**
 * Lowercase and strip punctuation, but keep French elisions as one token
 * (l'avenir, d'un, aujourd'hui, qu'il, s'est, …).
 */
export function tokenizeFrench(text) {
  if (!text) return []
  return normalizeApostrophes(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Split text for on-screen display: keep original casing/punctuation/newlines,
 * and group elisions (l'avenir) as a single clickable word.
 * Newlines stay as break tokens so pasted layout is not composed into one line.
 */
export function splitDisplayTokens(text) {
  if (!text) return []
  const normalized = normalizeApostrophes(text)
  const tokens = []
  const pattern = /([\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*)|(\s+)|([^\s\p{L}\p{N}]+)/gu
  let match
  while ((match = pattern.exec(normalized)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'word', value: match[1], lookup: match[1].toLowerCase() })
    } else if (match[2]) {
      const raw = match[2]
      if (raw.includes('\n') || raw.includes('\r')) {
        // Keep each newline as its own break; keep spaces on the same line as spaces.
        for (const ch of raw) {
          if (ch === '\n' || ch === '\r') {
            if (ch === '\r') continue
            tokens.push({ type: 'break', value: '\n' })
          } else if (ch === ' ' || ch === '\t') {
            tokens.push({ type: 'space', value: ch })
          } else {
            tokens.push({ type: 'space', value: ch })
          }
        }
      } else {
        tokens.push({ type: 'space', value: raw })
      }
    } else if (match[3]) {
      tokens.push({ type: 'punct', value: match[3] })
    }
  }
  return tokens
}
