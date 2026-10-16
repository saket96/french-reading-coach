export class WhisperUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WhisperUnavailableError'
  }
}

export function extractTranscript(payload) {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload.trim()
  if (typeof payload.text === 'string') return payload.text.trim()
  if (typeof payload.transcription === 'string') return payload.transcription.trim()
  if (Array.isArray(payload.segments)) {
    return payload.segments
      .map((seg) => seg?.text ?? '')
      .join(' ')
      .trim()
  }
  return ''
}

/** Collect word-level timestamps from Faster Whisper JSON when present. */
export function extractWordTimings(payload) {
  if (!payload || typeof payload !== 'object') return []
  const words = []

  const pushWord = (item) => {
    const raw = item?.word ?? item?.text ?? ''
    const token = String(raw).trim().toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')
    if (!token) return
    const start = Number(item.start ?? item.start_time)
    const end = Number(item.end ?? item.end_time)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return
    words.push({ word: token, start, end })
  }

  if (Array.isArray(payload.words)) {
    payload.words.forEach(pushWord)
  }

  if (Array.isArray(payload.segments)) {
    for (const seg of payload.segments) {
      if (Array.isArray(seg?.words)) {
        seg.words.forEach(pushWord)
      }
    }
  }

  return words
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function postAsr(blob) {
  const form = new FormData()
  form.append('audio_file', blob, 'reading.webm')
  return fetch('/asr?task=transcribe&language=fr&output=json&word_timestamps=true', {
    method: 'POST',
    body: form,
  })
}

function parseAsrResponse(response, bodyText) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return JSON.parse(bodyText)
  }
  try {
    return JSON.parse(bodyText)
  } catch {
    return bodyText.trim()
  }
}

export async function transcribeFrenchAudio(blob) {
  const maxAttempts = 4
  let lastStatus = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response
    try {
      response = await postAsr(blob)
    } catch {
      if (attempt < maxAttempts) {
        await sleep(1200 * attempt)
        continue
      }
      throw new WhisperUnavailableError(
        'Whisper n’est pas joignable. Dans le dossier du projet : `docker compose up -d` puis `docker compose logs -f whisper` — attendez que le modèle soit chargé.',
      )
    }

    lastStatus = response.status
    if (response.ok) {
      const bodyText = await response.text()
      const payload = parseAsrResponse(response, bodyText)
      if (typeof payload === 'string') {
        return { text: payload, words: [], raw: null }
      }
      return {
        text: extractTranscript(payload),
        words: extractWordTimings(payload),
        raw: payload,
      }
    }

    // 502/503/504 often mean the model is still loading after compose up
    if ([502, 503, 504].includes(response.status) && attempt < maxAttempts) {
      await sleep(1500 * attempt)
      continue
    }

    throw new WhisperUnavailableError(
      `Whisper a renvoyé ${response.status}. Relancez : \`docker compose restart whisper\` puis attendez ~30–60 s (chargement du modèle) avant de réessayer.`,
    )
  }

  throw new WhisperUnavailableError(
    `Whisper a renvoyé ${lastStatus || 'une erreur'}. Vérifiez \`docker compose ps\` et les logs whisper.`,
  )
}
