/**
 * MediaRecorder helpers — Opera/Chrome can drop the last WebM cluster
 * unless we use a timeslice and wait for the final dataavailable after stop().
 */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

export function pickRecorderMimeType() {
  if (typeof window === 'undefined' || !window.MediaRecorder?.isTypeSupported) return ''
  return MIME_CANDIDATES.find((type) => window.MediaRecorder.isTypeSupported(type)) ?? ''
}

export function extensionForAudioMime(mimeType = '') {
  const mime = String(mimeType).toLowerCase()
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export function audioFilenameForBlob(blob, fallback = 'reading') {
  const ext = extensionForAudioMime(blob?.type)
  return `${fallback}.${ext}`
}

/**
 * Stop a MediaRecorder and resolve with a single Blob once the final
 * dataavailable has been delivered (Opera often needs this wait).
 */
export function stopRecorderToBlob(recorder, chunks, { settleMs = 120 } = {}) {
  return new Promise((resolve, reject) => {
    if (!recorder) {
      reject(new Error('Enregistreur indisponible'))
      return
    }

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      const type = recorder.mimeType || chunks[0]?.type || 'audio/webm'
      const blob = new Blob(chunks, { type })
      resolve(blob)
    }

    const timer = window.setTimeout(finish, Math.max(settleMs, 40))

    const onStop = () => {
      // Final dataavailable can arrive just after stop in Opera/Blink.
      window.setTimeout(finish, settleMs)
    }

    recorder.addEventListener('stop', onStop, { once: true })

    try {
      if (recorder.state === 'recording') {
        try {
          recorder.requestData?.()
        } catch {
          // ignore
        }
        recorder.stop()
      } else if (recorder.state === 'paused') {
        recorder.resume()
        try {
          recorder.requestData?.()
        } catch {
          // ignore
        }
        recorder.stop()
      } else {
        finish()
      }
    } catch (err) {
      window.clearTimeout(timer)
      reject(err)
    }
  })
}

/** Minimum size for a usable Opus/WebM clip (~header + a bit of audio). */
export const MIN_AUDIO_BLOB_BYTES = 800
