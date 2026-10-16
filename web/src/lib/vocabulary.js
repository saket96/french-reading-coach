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
  }
  if (index >= 0) next[index] = { ...next[index], ...entry }
  else next.unshift(entry)
  return next
}

export function removeVocabularyEntry(entries, word) {
  const normalized = String(word ?? '')
    .trim()
    .toLowerCase()
  return entries.filter((item) => item.word !== normalized)
}
