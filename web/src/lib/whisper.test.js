import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractTranscript, extractWordTimings } from './whisper.js'

test('extractWordTimings reads segment words', () => {
  const words = extractWordTimings({
    text: 'Bonjour les amis',
    segments: [
      {
        words: [
          { word: 'Bonjour', start: 0.0, end: 0.4 },
          { word: 'les', start: 0.45, end: 0.6 },
          { word: 'amis', start: 0.65, end: 1.0 },
        ],
      },
    ],
  })
  assert.equal(words.length, 3)
  assert.equal(words[0].word, 'bonjour')
  assert.equal(words[2].end, 1.0)
})

test('extractTranscript still works', () => {
  assert.equal(extractTranscript({ text: '  Salut  ' }), 'Salut')
})
