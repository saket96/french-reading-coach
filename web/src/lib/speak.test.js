import { test } from 'node:test'
import assert from 'node:assert/strict'
import { charIndexAtWord, PACE_PRESETS, wordIndexFromCharIndex } from './speak.js'
import { splitDisplayTokens } from './tokenize.js'

test('pace presets expose learner speeds', () => {
  assert.ok(PACE_PRESETS.lent.wpm < PACE_PRESETS.moyen.wpm)
  assert.ok(PACE_PRESETS.moyen.wpm < PACE_PRESETS.rapide.wpm)
  assert.equal(PACE_PRESETS.libre.wpm, 0)
})

test('wordIndexFromCharIndex maps into display tokens', () => {
  const text = "L'avenir est beau"
  const tokens = splitDisplayTokens(text)
  assert.equal(wordIndexFromCharIndex(text, tokens, 0), 0)
  assert.ok(wordIndexFromCharIndex(text, tokens, 10) >= 0)
})

test('charIndexAtWord finds word starts for resume', () => {
  const text = 'Bonjour le monde'
  const tokens = splitDisplayTokens(text)
  assert.equal(charIndexAtWord(tokens, 0), 0)
  assert.equal(text.slice(charIndexAtWord(tokens, 1)), 'le monde')
  assert.equal(text.slice(charIndexAtWord(tokens, 2)), 'monde')
})
