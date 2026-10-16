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

export async function transcribeFrenchAudio(blob) {
  const form = new FormData()
  form.append('audio_file', blob, 'reading.webm')

  let response
  try {
    response = await fetch(
      '/asr?task=transcribe&language=fr&output=json&word_timestamps=true',
      {
        method: 'POST',
        body: form,
      },
    )
  } catch {
    throw new WhisperUnavailableError(
      'Whisper n’est pas joignable. Lancez `docker compose up -d` à la racine du projet, attendez que le modèle base soit chargé, puis réessayez.',
    )
  }

  if (!response.ok) {
    throw new WhisperUnavailableError(
      `Whisper a renvoyé une erreur (${response.status}). Vérifiez que le conteneur tourne sur le port 9000.`,
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || contentType.includes('text/plain')) {
    const payload = contentType.includes('application/json')
      ? await response.json()
      : JSON.parse(await response.text())
    return {
      text: extractTranscript(payload),
      words: extractWordTimings(payload),
      raw: payload,
    }
  }

  const text = (await response.text()).trim()
  try {
    const payload = JSON.parse(text)
    return {
      text: extractTranscript(payload),
      words: extractWordTimings(payload),
      raw: payload,
    }
  } catch {
    return { text, words: [], raw: null }
  }
}
