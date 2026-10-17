export class PronounceUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PronounceUnavailableError'
  }
}

/** Cheap readiness ping for the OpenPronounce container. */
export async function checkPronounceReady() {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch('/pronounce-health', {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) return { ready: false, status: response.status }
    const data = await response.json().catch(() => ({}))
    return {
      ready: response.ok && data?.openpronounce !== false,
      status: response.status,
      detail: data,
    }
  } catch {
    return { ready: false, status: 0 }
  } finally {
    window.clearTimeout(timer)
  }
}

async function readErrorDetail(response) {
  try {
    const data = await response.json()
    if (typeof data?.detail === 'string') return data.detail
    if (Array.isArray(data?.detail)) {
      return data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
    }
    if (typeof data?.message === 'string') return data.message
  } catch {
    try {
      const text = await response.text()
      if (text) return text.slice(0, 280)
    } catch {
      // ignore
    }
  }
  return ''
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
      'OpenPronounce n’est pas joignable. Sur votre Mac : `docker compose up -d --build pronounce` puis attendez le démarrage (port 8000).',
    )
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new PronounceUnavailableError(
        'OpenPronounce charge encore le modèle FR (~1.2 Go au premier essai). Attendez 1–3 min puis réessayez. `docker compose logs -f pronounce`',
      )
    }
    throw new PronounceUnavailableError(
      detail
        ? `OpenPronounce (${response.status}) : ${detail}`
        : `OpenPronounce a renvoyé une erreur (${response.status}). Vérifiez : docker compose logs --tail=80 pronounce`,
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
