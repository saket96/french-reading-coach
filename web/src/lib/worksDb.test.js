import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultWorkTitle } from './worksDb.js'

test('defaultWorkTitle uses first sentence when present', () => {
  assert.equal(
    defaultWorkTitle('L’éducation est essentielle. Suite.'),
    'L’éducation est essentielle',
  )
})

test('defaultWorkTitle truncates long openings', () => {
  const long = `${'a'.repeat(60)}. more`
  const title = defaultWorkTitle(long)
  assert.ok(title.endsWith('…'))
  assert.ok(title.length <= 48)
})
