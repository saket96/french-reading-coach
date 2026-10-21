import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitDisplayTokens } from './tokenize.js'

test('splitDisplayTokens keeps pasted newlines as breaks', () => {
  const tokens = splitDisplayTokens('Titre\n\nPremière phrase.')
  const types = tokens.map((t) => t.type)
  assert.ok(types.includes('break'))
  assert.equal(tokens.filter((t) => t.type === 'break').length, 2)
  assert.deepEqual(
    tokens.filter((t) => t.type === 'word').map((t) => t.lookup),
    ['titre', 'première', 'phrase'],
  )
})
