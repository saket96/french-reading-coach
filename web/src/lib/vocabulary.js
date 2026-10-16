const STORAGE_KEY = 'frc-vocabulary-v1'

export function loadVocabulary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveVocabulary(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // ignore
  }
}

export function upsertVocabularyEntry(entries, { word, translation, note = '' }) {
  const normalized = String(word ?? '')
    .trim()
    .toLowerCase()
  if (!normalized) return entries
  const next = [...entries]
  const index = next.findIndex((item) => item.word === normalized)
  const entry = {
    word: normalized,
    translation: String(translation ?? '').trim(),
    note: String(note ?? '').trim(),
    savedAt: new Date().toISOString(),
    reviews: 0,
    correct: 0,
    box: 1, // Leitner box 1–5
  }
  if (index >= 0) {
    next[index] = {
      ...entry,
      reviews: next[index].reviews ?? 0,
      correct: next[index].correct ?? 0,
      box: next[index].box ?? 1,
      savedAt: next[index].savedAt ?? entry.savedAt,
      translation: entry.translation || next[index].translation,
    }
  } else next.unshift(entry)
  return next
}

export function removeVocabularyEntry(entries, word) {
  const normalized = String(word ?? '')
    .trim()
    .toLowerCase()
  return entries.filter((item) => item.word !== normalized)
}

/** Shuffle copy for a review session; lower Leitner boxes first. */
export function buildReviewDeck(entries) {
  const list = [...(entries ?? [])].filter((e) => e.word && e.translation)
  list.sort((a, b) => (a.box ?? 1) - (b.box ?? 1) || Math.random() - 0.5)
  return list
}

export function gradeReviewEntry(entries, word, knewIt) {
  const normalized = String(word ?? '')
    .trim()
    .toLowerCase()
  return entries.map((item) => {
    if (item.word !== normalized) return item
    const box = Math.min(5, Math.max(1, (item.box ?? 1) + (knewIt ? 1 : -1)))
    return {
      ...item,
      box,
      reviews: (item.reviews ?? 0) + 1,
      correct: (item.correct ?? 0) + (knewIt ? 1 : 0),
      lastReviewedAt: new Date().toISOString(),
    }
  })
}
