const STORAGE_KEY = 'frc-custom-text'

export const CUSTOM_PASSAGE_ID = 'custom'

export function loadCustomText() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveCustomText(text) {
  try {
    localStorage.setItem(STORAGE_KEY, text)
  } catch {
    // ignore quota / private mode
  }
}

export function customPassage(text) {
  const trimmed = String(text ?? '').trim()
  return {
    id: CUSTOM_PASSAGE_ID,
    title: 'Mon texte',
    topic: 'Personnel',
    text: trimmed,
  }
}
