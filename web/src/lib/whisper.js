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

export async function transcribeFrenchAudio(blob) {
  const form = new FormData()
  form.append('audio_file', blob, 'reading.webm')

  let response
  try {
    response = await fetch('/asr?task=transcribe&language=fr&output=json', {
      method: 'POST',
      body: form,
    })
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
  if (contentType.includes('application/json')) {
    return extractTranscript(await response.json())
  }
  return (await response.text()).trim()
}
