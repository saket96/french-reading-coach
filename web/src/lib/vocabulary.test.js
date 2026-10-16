import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReviewDeck,
  gradeReviewEntry,
  upsertVocabularyEntry,
} from './vocabulary.js'

test('upsertVocabularyEntry stores Leitner box defaults', () => {
  const next = upsertVocabularyEntry([], { word: 'Bonjour', translation: 'Hello' })
  assert.equal(next.length, 1)
  assert.equal(next[0].word, 'bonjour')
  assert.equal(next[0].box, 1)
  assert.equal(next[0].reviews, 0)
})

test('gradeReviewEntry promotes and demotes boxes', () => {
  let entries = upsertVocabularyEntry([], { word: 'ami', translation: 'friend' })
  entries = gradeReviewEntry(entries, 'ami', true)
  assert.equal(entries[0].box, 2)
  assert.equal(entries[0].correct, 1)
  entries = gradeReviewEntry(entries, 'ami', false)
  assert.equal(entries[0].box, 1)
  assert.equal(entries[0].reviews, 2)
})

test('buildReviewDeck puts lower boxes first', () => {
  const entries = [
    { word: 'a', translation: 'a', box: 3 },
    { word: 'b', translation: 'b', box: 1 },
    { word: 'c', translation: 'c', box: 2 },
  ]
  const deck = buildReviewDeck(entries)
  assert.equal(deck[0].box, 1)
  assert.ok(deck.every((e) => e.translation))
})
