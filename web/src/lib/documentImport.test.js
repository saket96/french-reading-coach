import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectDocumentKind,
  layoutPdfTextItems,
  normalizeImportedText,
} from './documentImport.js'

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

test('layoutPdfTextItems inserts spaces between adjacent words on a line', () => {
  const text = layoutPdfTextItems([
    { str: 'Bonjour', transform: [12, 0, 0, 12, 50, 700], width: 48 },
    { str: 'le', transform: [12, 0, 0, 12, 110, 700], width: 14 },
    { str: 'monde.', transform: [12, 0, 0, 12, 132, 700], width: 40 },
  ])
  assert.equal(text, 'Bonjour le monde.')
})

test('layoutPdfTextItems keeps paragraph breaks on large vertical gaps', () => {
  const text = layoutPdfTextItems([
    { str: 'Premier paragraphe.', transform: [12, 0, 0, 12, 50, 700], width: 140 },
    { str: 'Deuxième paragraphe.', transform: [12, 0, 0, 12, 50, 640], width: 150 },
  ])
  assert.match(text, /Premier paragraphe\.\n\nDeuxième paragraphe\./)
})

test('layoutPdfTextItems joins wrapped lines with a space', () => {
  const text = layoutPdfTextItems([
    { str: 'Une longue', transform: [12, 0, 0, 12, 50, 700], width: 70, hasEOL: true },
    { str: 'phrase continue.', transform: [12, 0, 0, 12, 50, 686], width: 90 },
  ])
  assert.equal(text, 'Une longue phrase continue.')
})
