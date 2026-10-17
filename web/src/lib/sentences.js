import { splitDisplayTokens } from './tokenize.js'

/**
 * Display tokens annotated with sentenceIndex (0-based).
 * A new sentence starts after . ! ? …
 */
export function splitDisplayTokensWithSentences(text) {
  const tokens = splitDisplayTokens(text)
  let sentenceIndex = 0
  for (const token of tokens) {
    token.sentenceIndex = sentenceIndex
    if (token.type === 'punct' && /[.!?…]/.test(token.value)) {
      sentenceIndex += 1
    }
  }
  return tokens
}

/** Rebuild the surface text of one sentence from annotated tokens. */
export function sentenceTextFromTokens(tokens, sentenceIndex) {
  if (!Array.isArray(tokens) || sentenceIndex < 0) return ''
  return tokens
    .filter((t) => t.sentenceIndex === sentenceIndex)
    .map((t) => (t.type === 'break' ? ' ' : t.value))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
