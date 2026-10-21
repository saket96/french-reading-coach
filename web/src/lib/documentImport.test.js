import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDocumentKind, normalizeImportedText } from './documentImport.js'

test('normalizeImportedText collapses whitespace and blank lines', () => {
  const raw = 'Bonjour  le   monde.\n\n\n\nDeuxième  paragraphe.  \n'
  assert.equal(normalizeImportedText(raw), 'Bonjour le monde.\n\nDeuxième paragraphe.')
})

test('detectDocumentKind recognizes pdf and docx by name', () => {
  assert.equal(detectDocumentKind({ name: 'article.pdf', type: '' }), 'pdf')
  assert.equal(
    detectDocumentKind({
      name: 'notes.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    'docx',
  )
  assert.equal(detectDocumentKind({ name: 'old.doc', type: 'application/msword' }), 'doc')
  assert.equal(detectDocumentKind({ name: 'notes.txt', type: 'text/plain' }), '')
})
