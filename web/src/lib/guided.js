import { splitDisplayTokens } from './tokenize.js'

/** Word-only tokens with stable indices for highlighting. */
export function guidedWords(text) {
  return splitDisplayTokens(text)
    .filter((t) => t.type === 'word')
    .map((t, index) => ({ ...t, wordIndex: index }))
}

export function countGuidedWords(text) {
  return guidedWords(text).length
}
