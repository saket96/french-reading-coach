import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sentenceTextFromTokens, splitDisplayTokensWithSentences } from './sentences.js'

test('splitDisplayTokensWithSentences tags each sentence', () => {
  const tokens = splitDisplayTokensWithSentences('Bonjour le monde. Comment ça va ? Bien.')
  const bySentence = new Map()
  for (const t of tokens) {
    if (t.type !== 'word') continue
    const list = bySentence.get(t.sentenceIndex) ?? []
    list.push(t.lookup)
    bySentence.set(t.sentenceIndex, list)
  }
  assert.deepEqual(bySentence.get(0), ['bonjour', 'le', 'monde'])
  assert.deepEqual(bySentence.get(1), ['comment', 'ça', 'va'])
  assert.deepEqual(bySentence.get(2), ['bien'])
})

test('sentenceTextFromTokens rebuilds a line', () => {
  const tokens = splitDisplayTokensWithSentences('Premier. Deuxième !')
  assert.equal(sentenceTextFromTokens(tokens, 0), 'Premier.')
  assert.match(sentenceTextFromTokens(tokens, 1), /^Deuxième/)
})
