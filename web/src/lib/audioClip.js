/**
 * Play a time range from an audio element / URL (learner's own recording).
 * Returns a cleanup function that stops playback.
 */
export function playAudioRange(audioUrl, start, end, { padding = 0.08 } = {}) {
  if (!audioUrl || !Number.isFinite(start) || !Number.isFinite(end)) {
    return Promise.reject(new Error('Horodatage audio manquant'))
  }

  const audio = new Audio(audioUrl)
  const from = Math.max(0, start - padding)
  const to = Math.max(from + 0.12, end + padding)

  return new Promise((resolve, reject) => {
    const onTime = () => {
      if (audio.currentTime >= to) {
        audio.pause()
        cleanup()
        resolve()
      }
    }
    const onError = () => {
      cleanup()
      reject(new Error('Lecture du clip impossible'))
    }
    const cleanup = () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', cleanup)
      audio.removeEventListener('error', onError)
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', () => {
      cleanup()
      resolve()
    })
    audio.addEventListener('error', onError)
    audio.currentTime = from
    audio.play().catch(onError)
  })
}

/** Match a hyp word to the closest timed Whisper word. */
export function findTimingForHyp(timedWords, hypWord, hypIndex, hypCount) {
  if (!timedWords?.length || !hypWord) return null
  const needle = String(hypWord).toLowerCase()
  const exact = timedWords.find((w) => w.word === needle)
  if (exact) return exact

  // Fall back to proportional index when spelling differs slightly.
  if (hypCount > 0 && timedWords.length > 0) {
    const idx = Math.min(
      timedWords.length - 1,
      Math.round((hypIndex / Math.max(hypCount - 1, 1)) * (timedWords.length - 1)),
    )
    return timedWords[idx]
  }
  return null
}
