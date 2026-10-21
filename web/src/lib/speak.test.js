import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  charIndexAtWord,
  frenchAccentLabel,
  PACE_PRESETS,
  scoreFrenchVoiceNaturalness,
  splitTextForSpeech,
  wordIndexFromCharIndex,
} from './speak.js'
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

test('frenchAccentLabel maps regions', () => {
  assert.equal(frenchAccentLabel('fr-FR'), 'France')
  assert.equal(frenchAccentLabel('fr-CA'), 'Canada')
  assert.equal(frenchAccentLabel('fr-BE'), 'Belgique')
})

test('scoreFrenchVoiceNaturalness prefers natural FR-FR voices', () => {
  const amelie = scoreFrenchVoiceNaturalness({
    name: 'Amélie (Enhanced)',
    lang: 'fr-FR',
    localService: true,
  })
  const compact = scoreFrenchVoiceNaturalness({
    name: 'French Compact',
    lang: 'fr-FR',
    localService: true,
  })
  const english = scoreFrenchVoiceNaturalness({
    name: 'Samantha',
    lang: 'en-US',
    localService: true,
  })
  assert.ok(amelie > compact)
  assert.ok(amelie > english)
})

test('splitTextForSpeech keeps short text as one chunk', () => {
  assert.deepEqual(splitTextForSpeech('Bonjour.'), ['Bonjour.'])
})

test('splitTextForSpeech splits long multi-sentence text', () => {
  const text = Array.from({ length: 8 }, (_, i) => `Phrase numéro ${i + 1} avec du contenu.`).join(
    ' ',
  )
  const parts = splitTextForSpeech(text, 80)
  assert.ok(parts.length > 1)
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '))
})
