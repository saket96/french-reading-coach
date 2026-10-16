import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeFrench } from './tokenize.js'
import { alignWords, frenchMatchKind, practiceErrors } from './align.js'
import { passages } from '../passages.js'

test('tokenize keeps accents and French elisions', () => {
  assert.deepEqual(tokenizeFrench("L'été, d'un côté : « déjà » !"), [
    "l'été",
    "d'un",
    'côté',
    'déjà',
  ])
  assert.deepEqual(tokenizeFrench("l'avenir et aujourd'hui"), [
    "l'avenir",
    'et',
    "aujourd'hui",
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

test('frenchMatchKind treats accents and gender as close', () => {
  assert.equal(frenchMatchKind('télétravail', 'teletravail'), 'close')
  assert.equal(frenchMatchKind('réservé', 'reserve'), 'close')
  assert.equal(frenchMatchKind('un', 'une'), 'close')
  assert.equal(frenchMatchKind('imposé', 'imposées'), 'close')
  assert.equal(frenchMatchKind("s'est", 'ces'), 'close')
  assert.equal(frenchMatchKind('bilan', 'porter'), 'different')
})

test('alignment soft-matches French near forms', () => {
  const target = tokenizeFrench('Le télétravail est réservé aux professions.')
  const hyp = tokenizeFrench('Le teletravail est reserve aux professions.')
  const result = alignWords(target, hyp)
  assert.ok(result.score >= 0.8)
  assert.ok(result.ops.every((op) => op.type === 'match' || op.type === 'close'))
})

test('alignment still flags real word errors', () => {
  const target = tokenizeFrench('Le télétravail change la vie des salariés.')
  const hyp = tokenizeFrench('Le chaton change la ville des salariés extra')
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

test('practiceErrors skips tiny function words', () => {
  const ops = [
    { type: 'wrong', target: 'le', hyp: 'télé' },
    { type: 'wrong', target: 'professions', hyp: 'professionnels' },
    { type: 'close', target: 'un', hyp: 'une' },
  ]
  const list = practiceErrors(ops)
  assert.equal(list.length, 1)
  assert.equal(list[0].target, 'professions')
})
