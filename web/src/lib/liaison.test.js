import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeLiaisons, analyzeTerminations } from './liaison.js'
import { buildFocusReview } from './review.js'
import { alignWords } from './align.js'
import { tokenizeFrench } from './tokenize.js'

test('analyzeLiaisons finds classic sites', () => {
  const { sites } = analyzeLiaisons('Les amis sont arrivés.', 'Les amis sont arrivés.')
  assert.ok(sites.some((s) => s.pair === 'les amis'))
})

test('analyzeTerminations flags truncated endings', () => {
  const ops = [{ type: 'wrong', target: 'professionnel', hyp: 'profession' }]
  const issues = analyzeTerminations(ops)
  assert.ok(issues.some((i) => i.word === 'professionnel'))
})

test('buildFocusReview prioritizes wrong words', () => {
  const alignment = alignWords(
    tokenizeFrench('Les amis travaillent demain'),
    tokenizeFrench('Les chats mangent demain'),
  )
  const review = buildFocusReview({
    alignment,
    liaisonSites: [{ left: 'les', right: 'amis', pair: 'les amis' }],
    liaisonIssues: [],
    terminationIssues: [],
    pronounceTips: null,
  })
  assert.ok(
    review.focuses.some((f) => f.id === 'words' || f.id === 'close' || f.id === 'asr'),
  )
  assert.ok(review.summary)
})
