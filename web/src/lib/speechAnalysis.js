/**
 * Structure Whisper + alignment + OpenPronounce signals into a TCF-style
 * pronunciation / fluency / grammar / vocab evaluation (no extra LLM required).
 */

import { alignWords } from './align.js'
import { buildFocusReview } from './review.js'
import { analyzeLiaisons, analyzeTerminations } from './liaison.js'

const NASAL_RE = /(?:an|en|in|on|un|ain|ein|oin|amn|emn)[^\p{L}]|[ãẽĩõũ]/giu
const R_SOUND_RE = /(?:r|rr)/i
const U_OU_PAIRS = [
  ['u', 'ou'],
  ['tu', 'tout'],
  ['vu', 'vous'],
  ['rue', 'roux'],
  ['plus', 'ploue'],
]
const E_ACCENT_RE = /[éèêë]/i

/**
 * @param {{
 *   expectedText: string,
 *   transcript: string,
 *   pronounceTips?: { score?: number, errors?: Array<{phone?:string,word?:string,message?:string}> } | null,
 *   whisperWords?: Array<{word:string}> | null,
 *   durationMs?: number,
 * }} input
 */
export function analyzeSpeechAttempt(input) {
  const expectedText = String(input.expectedText || '').trim()
  const transcript = String(input.transcript || '').trim()
  const pronounceTips = input.pronounceTips || null
  const durationMs = Number(input.durationMs) || 0

  const alignment = expectedText && transcript ? alignWords(expectedText, transcript) : null
  const liaisonAnalysis = analyzeLiaisons(expectedText, transcript, alignment?.ops ?? [])
  const terminationIssues = analyzeTerminations(alignment?.ops ?? [])
  const focusReview = buildFocusReview({
    alignment,
    liaisonSites: liaisonAnalysis.sites,
    liaisonIssues: liaisonAnalysis.issues,
    terminationIssues,
    pronounceTips,
  })

  const pronunciation = buildPronunciationSection({
    alignment,
    pronounceTips,
    expectedText,
    transcript,
  })
  const fluency = buildFluencySection({
    expectedText,
    transcript,
    alignment,
    durationMs,
    whisperWords: input.whisperWords,
  })
  const grammar = buildGrammarSection({ alignment, expectedText, transcript })
  const vocabulary = buildVocabularySection({ alignment })
  const listeningRecall = buildListeningRecallSection({ alignment, focusReview })

  const weaknesses = collectWeaknesses({
    pronunciation,
    fluency,
    grammar,
    vocabulary,
    listeningRecall,
    focusReview,
  })

  const overallScore = scoreOverall({
    alignment,
    pronounceTips,
    fluency,
    grammar,
  })

  return {
    overallScore,
    summary: focusReview?.summary || buildSummary(overallScore, weaknesses),
    pronunciation,
    fluency,
    grammar,
    vocabulary,
    listeningRecall,
    focusReview,
    alignment,
    weaknesses,
    comparedToExpected: {
      missingWords: (alignment?.ops || []).filter((op) => op.type === 'missing').map((op) => op.target),
      wrongWords: (alignment?.ops || [])
        .filter((op) => op.type === 'wrong')
        .map((op) => ({ expected: op.target, heard: op.hyp })),
      extraWords: (alignment?.ops || []).filter((op) => op.type === 'extra').map((op) => op.hyp),
    },
  }
}

function buildPronunciationSection({ alignment, pronounceTips, expectedText, transcript }) {
  const issues = []
  const phoneErrors = Array.isArray(pronounceTips?.errors) ? pronounceTips.errors : []

  for (const err of phoneErrors.slice(0, 12)) {
    const msg = String(err.message || err.phone || '')
    const word = err.word || ''
    let tag = 'consonne'
    if (/nasal|ã|ẽ|ĩ|õ|œ̃/i.test(msg) || NASAL_RE.test(word)) tag = 'voyelle-nasale'
    else if (/\br\b|ʁ|uvular/i.test(msg) || (R_SOUND_RE.test(word) && /r/i.test(msg))) tag = 'r-francais'
    else if (/[uy]|ou|ü/i.test(msg)) tag = 'u-vs-ou'
    else if (/[eéèê]|ouvert|fermé/i.test(msg) || E_ACCENT_RE.test(word)) tag = 'e-accent'
    else if (/liaison/i.test(msg)) tag = 'liaison'
    else if (/final|ending|terminaison/i.test(msg)) tag = 'terminaison'
    issues.push({
      tag,
      label: labelForPronTag(tag),
      word,
      detail: msg || `Contrôlez la prononciation de « ${word} ».`,
    })
  }

  // Heuristic from wrong pairs that often confuse U/OU or É/È
  for (const op of (alignment?.ops || []).filter((o) => o.type === 'wrong').slice(0, 8)) {
    const a = fold(op.target)
    const b = fold(op.hyp)
    for (const [x, y] of U_OU_PAIRS) {
      if ((a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))) {
        issues.push({
          tag: 'u-vs-ou',
          label: 'U vs OU',
          word: op.target,
          detail: `Attendu « ${op.target} », entendu « ${op.hyp} » — distinction u / ou.`,
        })
      }
    }
    if (/[éè]/.test(op.target || '') && fold(op.target) === fold(op.hyp)) {
      issues.push({
        tag: 'e-accent',
        label: 'É vs È',
        word: op.target,
        detail: `Accent ou ouverture de la voyelle sur « ${op.target} ».`,
      })
    }
  }

  if (NASAL_RE.test(expectedText) && alignment?.score != null && alignment.score < 75) {
    issues.push({
      tag: 'voyelle-nasale',
      label: 'Voyelles nasales',
      word: '',
      detail: 'Le passage contient des nasales (an/en/in/on/un) — soignez la résonance sans fermer trop la bouche.',
    })
  }

  const unique = dedupeIssues(issues)
  return {
    score: pronounceTips?.score != null ? Number(pronounceTips.score) : estimatePronScore(alignment),
    issues: unique,
    note: pronounceTips?.note || '',
    clarity:
      unique.some((i) => i.tag === 'voyelle-nasale' || i.tag === 'u-vs-ou')
        ? 'Travaillez la clarté des voyelles (nasales, u/ou, é/è).'
        : 'Clarté globale acceptable ; affinez les phonèmes signalés.',
  }
}

function buildFluencySection({ expectedText, transcript, alignment, durationMs, whisperWords }) {
  const expectedWords = tokenize(expectedText)
  const spokenWords = tokenize(transcript)
  const minutes = durationMs > 0 ? durationMs / 60000 : 0
  const wpm = minutes > 0.05 ? Math.round(spokenWords.length / minutes) : null
  const extra = (alignment?.ops || []).filter((op) => op.type === 'extra').length
  const missing = (alignment?.ops || []).filter((op) => op.type === 'missing').length
  const hesitationMarkers = (transcript.match(/\b(euh|heu|hum|hmm|bah|ben)\b/gi) || []).length
  const wordTimings = Array.isArray(whisperWords) ? whisperWords : []
  let longPauses = 0
  for (let i = 1; i < wordTimings.length; i += 1) {
    const prev = wordTimings[i - 1]
    const cur = wordTimings[i]
    const gap = Number(cur?.start) - Number(prev?.end)
    if (Number.isFinite(gap) && gap > 0.85) longPauses += 1
  }

  const issues = []
  if (hesitationMarkers >= 2) {
    issues.push({
      tag: 'hesitation',
      label: 'Hésitations',
      detail: `${hesitationMarkers} marqueurs d’hésitation détectés (euh, hum…).`,
    })
  }
  if (longPauses >= 2) {
    issues.push({
      tag: 'pauses',
      label: 'Pauses longues',
      detail: `${longPauses} pauses > 0,85 s entre mots — travaillez l’enchaînement.`,
    })
  }
  if (wpm != null && wpm < 80) {
    issues.push({
      tag: 'rythme-lent',
      label: 'Débit trop lent',
      detail: `Environ ${wpm} mots/min. Visez ~110–150 pour un oral naturel.`,
    })
  }
  if (wpm != null && wpm > 190) {
    issues.push({
      tag: 'rythme-rapide',
      label: 'Débit trop rapide',
      detail: `Environ ${wpm} mots/min. Ralentissez pour les liaisons et la clarté.`,
    })
  }
  if (extra >= 3) {
    issues.push({
      tag: 'repetition',
      label: 'Répétitions / ajouts',
      detail: 'Plusieurs mots en trop par rapport au modèle — évitez de reformuler pendant la lecture.',
    })
  }

  const coverage =
    expectedWords.length > 0
      ? Math.round(((expectedWords.length - missing) / expectedWords.length) * 100)
      : 0
  const score = clamp(
    Math.round(
      (coverage * 0.45) +
        (wpm == null ? 70 : wpm >= 100 && wpm <= 160 ? 90 : wpm >= 85 && wpm <= 180 ? 75 : 55) * 0.35 +
        (Math.max(0, 100 - hesitationMarkers * 8 - longPauses * 10) * 0.2),
    ),
  )

  return {
    score,
    wpm,
    coverage,
    hesitationMarkers,
    longPauses,
    issues,
    naturalness:
      score >= 80 ? 'Rythme plutôt naturel.' : score >= 60 ? 'Rythme perfectible.' : 'Rythme à stabiliser.',
  }
}

function buildGrammarSection({ alignment, expectedText, transcript }) {
  const issues = []
  const wrong = (alignment?.ops || []).filter((op) => op.type === 'wrong')
  for (const op of wrong.slice(0, 10)) {
    const target = op.target || ''
    const hyp = op.hyp || ''
    if (looksLikeConjugationMismatch(target, hyp)) {
      issues.push({
        tag: 'conjugaison',
        label: 'Conjugaison',
        expected: target,
        heard: hyp,
        detail: `Forme verbale : attendu « ${target} », entendu « ${hyp} ».`,
      })
    } else if (looksLikeAgreementMismatch(target, hyp)) {
      issues.push({
        tag: 'accord',
        label: 'Accord',
        expected: target,
        heard: hyp,
        detail: `Accord possible (genre/nombre) : « ${target} » vs « ${hyp} ».`,
      })
    }
  }
  // Missing verbs / auxiliaries
  for (const op of (alignment?.ops || []).filter((o) => o.type === 'missing').slice(0, 8)) {
    if (COMMON_VERBS.has(fold(op.target))) {
      issues.push({
        tag: 'mot-manquant-verbe',
        label: 'Verbe omis',
        expected: op.target,
        heard: '',
        detail: `Le verbe « ${op.target} » semble absent de l’oral.`,
      })
    }
  }

  const score = clamp(
    Math.round(100 - issues.length * 8 - wrong.length * 2),
  )
  return {
    score,
    issues: dedupeIssues(issues),
    note:
      issues.length === 0
        ? 'Peu d’écarts grammaticaux détectés à l’oral (sur la base de la transcription).'
        : 'Écarts de forme détectés via la transcription — vérifiez conjugaison et accords.',
    expectedSample: expectedText.slice(0, 120),
    transcriptSample: transcript.slice(0, 120),
  }
}

function buildVocabularySection({ alignment }) {
  const missing = (alignment?.ops || [])
    .filter((op) => op.type === 'missing')
    .map((op) => op.target)
    .filter(Boolean)
  const wrong = (alignment?.ops || [])
    .filter((op) => op.type === 'wrong')
    .map((op) => op.target)
    .filter(Boolean)
  const issues = []
  if (missing.length) {
    issues.push({
      tag: 'mots-manquants',
      label: 'Mots manquants',
      detail: `Non dits ou non reconnus : ${missing.slice(0, 8).join(', ')}.`,
      examples: missing.slice(0, 8),
    })
  }
  if (wrong.length) {
    issues.push({
      tag: 'mots-altérés',
      label: 'Mots altérés',
      detail: `Différents du modèle : ${wrong.slice(0, 8).join(', ')}.`,
      examples: wrong.slice(0, 8),
    })
  }
  const score = clamp(Math.round(100 - missing.length * 5 - wrong.length * 3))
  return { score, missingWords: missing, alteredWords: wrong, issues }
}

function buildListeningRecallSection({ alignment, focusReview }) {
  const missing = (alignment?.ops || []).filter((op) => op.type === 'missing').length
  const score = clamp(Math.round((alignment?.score ?? 70) - missing * 2))
  return {
    score,
    detail:
      missing > 0
        ? 'Des mots du modèle n’apparaissent pas dans votre oral — réécoutez phrase par phrase puis reformulez.'
        : 'Bonne couverture du texte modèle.',
    focuses: (focusReview?.focuses || []).slice(0, 4),
  }
}

function collectWeaknesses(sections) {
  const out = []
  const push = (kind, label, detail, examples = []) => {
    out.push({
      id: `${kind}:${fold(label).slice(0, 40)}`,
      kind,
      label,
      detail,
      examples,
    })
  }
  for (const issue of sections.pronunciation?.issues || []) {
    push('pronunciation', issue.label, issue.detail, issue.word ? [issue.word] : [])
  }
  for (const issue of sections.fluency?.issues || []) {
    push('fluency', issue.label, issue.detail)
  }
  for (const issue of sections.grammar?.issues || []) {
    push('grammar', issue.label, issue.detail, [issue.expected, issue.heard].filter(Boolean))
  }
  for (const issue of sections.vocabulary?.issues || []) {
    push('vocabulary', issue.label, issue.detail, issue.examples || [])
  }
  return dedupeIssues(out)
}

function scoreOverall({ alignment, pronounceTips, fluency, grammar }) {
  const alignScore = Number(alignment?.score)
  const phoneScore = Number(pronounceTips?.score)
  const flu = Number(fluency?.score)
  const gram = Number(grammar?.score)
  const parts = []
  if (Number.isFinite(alignScore)) parts.push([alignScore, 0.35])
  if (Number.isFinite(phoneScore)) parts.push([phoneScore, 0.3])
  if (Number.isFinite(flu)) parts.push([flu, 0.2])
  if (Number.isFinite(gram)) parts.push([gram, 0.15])
  if (!parts.length) return null
  const weightSum = parts.reduce((s, [, w]) => s + w, 0)
  const total = parts.reduce((s, [v, w]) => s + v * w, 0) / weightSum
  return Math.round(total * 10) / 10
}

function buildSummary(overallScore, weaknesses) {
  if (overallScore == null) return 'Analyse partielle — réessayez avec Whisper prêt.'
  const top = weaknesses.slice(0, 3).map((w) => w.label)
  if (overallScore >= 85) {
    return `Très bon essai (${overallScore}/100).${top.length ? ` À peaufiner : ${top.join(', ')}.` : ''}`
  }
  if (overallScore >= 70) {
    return `Bon essai (${overallScore}/100). Priorités : ${top.join(', ') || 'rythme et liaisons'}.`
  }
  return `Essai à retravailler (${overallScore}/100). Focus : ${top.join(', ') || 'prononciation et mots manquants'}.`
}

function labelForPronTag(tag) {
  return (
    {
      'r-francais': 'R français',
      'voyelle-nasale': 'Voyelles nasales',
      'u-vs-ou': 'U vs OU',
      'e-accent': 'É vs È',
      liaison: 'Liaison',
      terminaison: 'Terminaisons',
      consonne: 'Consonnes',
    }[tag] || 'Prononciation'
  )
}

function estimatePronScore(alignment) {
  if (!alignment || alignment.score == null) return null
  return clamp(Math.round(alignment.score * 0.9 + 5))
}

function looksLikeConjugationMismatch(a, b) {
  const fa = fold(a)
  const fb = fold(b)
  if (!fa || !fb || fa === fb) return false
  if (fa.length < 3 || fb.length < 3) return false
  // Same stem prefix, different ending → likely conjugation / tense
  const stem = fa.slice(0, Math.min(4, fa.length - 1))
  return fb.startsWith(stem.slice(0, 3)) && fa.slice(-2) !== fb.slice(-2)
}

function looksLikeAgreementMismatch(a, b) {
  const fa = fold(a)
  const fb = fold(b)
  if (!fa || !fb) return false
  return (
    (fa + 'e' === fb || fb + 'e' === fa || fa + 's' === fb || fb + 's' === fa || fa + 'es' === fb || fb + 'es' === fa)
  )
}

const COMMON_VERBS = new Set(
  [
    'etre',
    'avoir',
    'faire',
    'aller',
    'dire',
    'pouvoir',
    'vouloir',
    'devoir',
    'savoir',
    'voir',
    'venir',
    'parler',
    'prendre',
    'est',
    'sont',
    'a',
    'ont',
    'fait',
    'peut',
  ].map(fold),
)

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .match(/[a-z0-9']+/g) || []
}

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

function clamp(n) {
  return Math.max(0, Math.min(100, n))
}

function dedupeIssues(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = `${item.tag || item.kind || ''}|${item.label}|${item.word || item.expected || ''}|${item.detail || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
