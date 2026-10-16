export class PronounceUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PronounceUnavailableError'
  }
}

/**
 * Local OpenPronounce phoneme scoring (French).
 * Returns null fields gracefully when the service is down — Whisper alignment still works.
 */
export async function assessFrenchPronunciation(blob, expectedText) {
  const form = new FormData()
  form.append('file', blob, 'reading.webm')
  form.append('expected_text', expectedText)
  form.append('lang', 'fr')

  let response
  try {
    response = await fetch('/pronunciation', {
      method: 'POST',
      body: form,
    })
  } catch {
    throw new PronounceUnavailableError(
      'OpenPronounce n’est pas joignable. Lancez `docker compose up -d` (service pronounce sur le port 8000).',
    )
  }

  if (!response.ok) {
    throw new PronounceUnavailableError(
      `OpenPronounce a renvoyé une erreur (${response.status}).`,
    )
  }

  return response.json()
}

/** Normalize OpenPronounce payload into UI-friendly word tips. */
export function extractPronunciationTips(payload) {
  if (!payload || typeof payload !== 'object') return { score: null, errors: [], transcript: '' }

  const score =
    typeof payload.score === 'number'
      ? payload.score
      : typeof payload.score === 'string'
        ? Number.parseFloat(payload.score)
        : null

  const rawErrors = payload.differences?.errors ?? payload.errors ?? []
  const errors = (Array.isArray(rawErrors) ? rawErrors : []).map((err) => ({
    word: err.word ?? err.target ?? '',
    expected: err.expected ?? '',
    actual: err.actual ?? err.heard ?? '',
    confidence: typeof err.confidence === 'number' ? err.confidence : null,
  }))

  const transcript =
    (typeof payload.transcribe === 'string' && payload.transcribe) ||
    (typeof payload.transcript === 'string' && payload.transcript) ||
    ''

  return { score: Number.isFinite(score) ? score : null, errors, transcript }
}
