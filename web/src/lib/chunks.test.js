import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSentences, chunkSentences, passageChunks } from './chunks.js'
import { passages } from '../passages.js'
import { extractPronunciationTips } from './pronounce.js'

test('splitSentences keeps French sentence boundaries', () => {
  const text =
    'Premier. Deuxième ! Troisième ? Quatrième… Cinquième.'
  assert.deepEqual(splitSentences(text), [
    'Premier.',
    'Deuxième !',
    'Troisième ?',
    'Quatrième…',
    'Cinquième.',
  ])
})

test('chunkSentences groups by twos', () => {
  assert.deepEqual(chunkSentences(['A.', 'B.', 'C.', 'D.', 'E.'], 2), [
    'A. B.',
    'C. D.',
    'E.',
  ])
})

test('chunkSentences size 1 is shadowing mode', () => {
  assert.deepEqual(chunkSentences(['A.', 'B.', 'C.'], 1), ['A.', 'B.', 'C.'])
})

test('each passage yields multiple practice chunks', () => {
  for (const passage of passages) {
    const chunks = passageChunks(passage.text, 2)
    assert.ok(chunks.length >= 3, `${passage.id} should have several steps`)
    assert.ok(chunks.every((c) => c.length > 20))
  }
})

test('extractPronunciationTips normalizes OpenPronounce payload', () => {
  const tips = extractPronunciationTips({
    score: 72.5,
    transcribe: 'bonjour',
    differences: {
      errors: [
        {
          word: 'privilège',
          expected: 'pʁivilɛʒ',
          actual: 'pʁivilɛdʒ',
          confidence: 0.8,
        },
      ],
    },
  })
  assert.equal(tips.score, 72.5)
  assert.equal(tips.errors[0].word, 'privilège')
  assert.equal(tips.transcript, 'bonjour')
})
