/**
 * Split a French passage into sentence pairs (2 "lines" per practice step).
 */
export function splitSentences(text) {
  if (!text?.trim()) return []
  const parts = String(text)
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts
}

/** Group consecutive sentences into chunks of `size` (default 2). */
export function chunkSentences(sentences, size = 2) {
  if (!Array.isArray(sentences) || size < 1) return []
  const chunks = []
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size).join(' '))
  }
  return chunks
}

export function passageChunks(passageText, size = 2) {
  return chunkSentences(splitSentences(passageText), size)
}
