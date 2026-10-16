import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeFrench } from './tokenize.js'
import { alignWords } from './align.js'
import { passages } from '../passages.js'

test('tokenize keeps accents and strips punctuation', () => {
  assert.deepEqual(tokenizeFrench('L’été, d’un côté : « déjà » !'), [
    'l',
    'été',
    'd',
    'un',
    'côté',
    'déjà',
  ])
})

test('passages are original B2 length', () => {
  assert.ok(passages.length >= 10)
  for (const passage of passages) {
    const words = passage.text.trim().split(/\s+/).filter(Boolean)
    assert.ok(
      words.length >= 100 && words.length <= 200,
      `${passage.id} has ${words.length} words`,
    )
  }
})

test('alignment scores matches over target words', () => {
  const target = tokenizeFrench('Le télétravail change la vie des salariés.')
  const hyp = tokenizeFrench('Le teletravail change la ville des salariés extra')
  const result = alignWords(target, hyp)
  assert.equal(result.targetCount, 7)
  assert.ok(result.ops.some((op) => op.type === 'wrong' || op.type === 'missing'))
  assert.ok(result.ops.some((op) => op.type === 'extra'))
  assert.equal(result.score, result.matched / result.targetCount)
})

test('fixture-like near-perfect reading scores high', () => {
  const passage = passages[0]
  const tokens = tokenizeFrench(passage.text)
  const result = alignWords(tokens, tokens)
  assert.equal(result.score, 1)
  assert.equal(result.matched, result.targetCount)
})
