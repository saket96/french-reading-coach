import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importBrowserBackup } from './browserBackup.js'

test('importBrowserBackup rejects non-app payloads', async () => {
  await assert.rejects(
    () => importBrowserBackup({ app: 'other-app', works: [] }),
    /Coach de lecture/,
  )
})

test('importBrowserBackup rejects empty input', async () => {
  await assert.rejects(() => importBrowserBackup(null), /invalide/)
})
