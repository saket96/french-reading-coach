import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSpeechAttempt } from './speechAnalysis.js'

test('analyzeSpeechAttempt scores a close reading', () => {
  const expected =
    'Le télétravail s’est imposé dans de nombreux secteurs. Son bilan reste pourtant nuancé.'
  const transcript =
    'Le teletravail sest impose dans de nombreux secteurs. Son bilan reste pourtant nuance.'
  const result = analyzeSpeechAttempt({
    expectedText: expected,
    transcript,
    pronounceTips: { score: 82, errors: [] },
    durationMs: 12_000,
  })
  assert.ok(result.overallScore != null)
  assert.ok(result.overallScore >= 50)
  assert.ok(result.pronunciation)
  assert.ok(result.fluency)
  assert.ok(result.grammar)
  assert.ok(Array.isArray(result.weaknesses))
})

test('analyzeSpeechAttempt flags missing words as vocabulary weakness', () => {
  const result = analyzeSpeechAttempt({
    expectedText: 'Les salariés gagnent du temps de trajet et trouvent un meilleur équilibre.',
    transcript: 'Les salaries gagnent du temps.',
    pronounceTips: { score: 60, errors: [{ word: 'salariés', message: 'nasal vowel' }] },
    durationMs: 8_000,
  })
  assert.ok(result.vocabulary.missingWords.length >= 1)
  assert.ok(result.weaknesses.some((w) => w.kind === 'vocabulary' || w.kind === 'pronunciation'))
  assert.ok(result.summary)
})
