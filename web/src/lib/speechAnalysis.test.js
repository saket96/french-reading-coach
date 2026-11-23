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
  assert.equal(result.pronunciation.source, 'openpronounce')
  assert.equal(result.pronunciation.whisperNormalized, false)
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

test('perfect Whisper transcript + low OpenPronounce keeps pronunciation low and does not inflate overall', () => {
  const expected =
    'Le télétravail s’est imposé dans de nombreux secteurs. Son bilan reste pourtant nuancé.'
  const transcript = expected
  const result = analyzeSpeechAttempt({
    expectedText: expected,
    transcript,
    pronounceTips: {
      score: 42,
      errors: [
        {
          word: 'nuancé',
          expected: 'nyɑ̃se',
          actual: 'nyanse',
        },
        {
          word: 'imposé',
          expected: 'ɛ̃poze',
          actual: 'inpoze',
        },
      ],
    },
    durationMs: 11_000,
  })

  const alignPct = Math.round((result.alignment?.score ?? 0) * 100)
  assert.ok(alignPct >= 90, `Whisper alignment should look near-perfect (got ${alignPct})`)
  assert.equal(result.pronunciation.score, 42)
  assert.equal(result.pronunciation.whisperNormalized, false)
  assert.equal(result.pronunciation.source, 'openpronounce')
  assert.ok(
    result.pronunciation.issues.some((i) => i.word === 'nuancé' || /nyɑ̃se|phonème|nasal/i.test(i.detail)),
    'OpenPronounce errors must surface as pronunciation issues',
  )
  assert.ok(
    result.weaknesses.some((w) => w.kind === 'pronunciation'),
    'OpenPronounce errors become weaknesses even with perfect Whisper',
  )
  // Overall must not be dragged up near alignment (~100); phoneme weight dominates.
  assert.ok(result.overallScore != null)
  assert.ok(
    result.overallScore < 70,
    `overall should stay low with phone=42 (got ${result.overallScore})`,
  )
  assert.ok(
    result.overallScore < alignPct - 15,
    'overall must stay well below Whisper alignment when OpenPronounce is poor',
  )
})

test('no OpenPronounce + high alignment → capped whisper-normalized pronunciation, not ~90', () => {
  const expected =
    'Le télétravail s’est imposé dans de nombreux secteurs. Son bilan reste pourtant nuancé.'
  const transcript = expected
  const result = analyzeSpeechAttempt({
    expectedText: expected,
    transcript,
    pronounceTips: null,
    durationMs: 10_000,
  })

  const alignPct = Math.round((result.alignment?.score ?? 0) * 100)
  assert.ok(alignPct >= 90, `expected high alignment (got ${alignPct})`)
  assert.equal(result.pronunciation.whisperNormalized, true)
  assert.equal(result.pronunciation.source, 'whisper-estimate')
  assert.ok(result.pronunciation.score != null)
  assert.ok(
    result.pronunciation.score <= 70,
    `whisper-derived pronunciation must be penalized (got ${result.pronunciation.score})`,
  )
  assert.ok(
    result.pronunciation.score <= Math.round(alignPct * 0.65),
    'estimate must stay in the ~0.55–0.65 alignment band',
  )
  assert.equal(result.pronunciation.score, Math.round(alignPct * 0.6))
  assert.match(result.pronunciation.note || '', /Whisper|OpenPronounce|normalise|prononciation/i)
  assert.ok(
    result.weaknesses.some((w) => /Whisper|OpenPronounce|prononciation/i.test(w.label + w.detail)),
  )
})
