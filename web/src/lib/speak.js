let speakGeneration = 0

function loadVoices() {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length) return Promise.resolve(voices)
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    // Safari / Chrome sometimes never fire voiceschanged if empty
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(window.speechSynthesis.getVoices())
    }, 600)
  })
}

/** Prefer a French voice; otherwise any voice (lang still set to fr-FR). */
export async function pickFrenchVoice() {
  const voices = await loadVoices()
  const fr = voices.filter((v) => v.lang?.toLowerCase().startsWith('fr'))
  return (
    fr.find((v) =>
      /thomas|am[eé]lie|audrey|google.*fran|marie|claire|daniel|thomas|virginie|hortense|fiona|sébastien|sebastien/i.test(
        v.name,
      ),
    ) ||
    fr[0] ||
    null
  )
}

/**
 * Speak French text. Optional onBoundary(charIndex) for guided highlighting.
 * Tolerates missing fr-FR voices and cancel/interrupted races on Chrome/Safari.
 */
export async function speakFrench(text, { rate = 0.92, onBoundary } = {}) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('Synthèse vocale indisponible dans ce navigateur')
  }

  const generation = ++speakGeneration
  window.speechSynthesis.cancel()
  // Let the cancel settle (Chrome often fires "interrupted" otherwise)
  await new Promise((r) => window.setTimeout(r, 80))
  if (generation !== speakGeneration) return

  // Chrome can leave the synth paused after cancel
  try {
    window.speechSynthesis.resume()
  } catch {
    // ignore
  }

  const voice = await pickFrenchVoice()
  if (generation !== speakGeneration) return

  return new Promise((resolve, reject) => {
    if (generation !== speakGeneration) {
      resolve()
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = voice?.lang?.startsWith('fr') ? voice.lang : 'fr-FR'
    utterance.rate = rate
    if (voice) utterance.voice = voice

    if (typeof onBoundary === 'function') {
      utterance.onboundary = (event) => {
        if (generation !== speakGeneration) return
        if (event.name === 'word' || event.name === 'Sentence' || !event.name) {
          onBoundary(event.charIndex ?? 0, event.charLength ?? 0)
        }
      }
    }

    utterance.onend = () => {
      if (generation === speakGeneration) resolve()
      else resolve()
    }

    utterance.onerror = (event) => {
      const reason = event?.error || ''
      // Expected when we cancel to start a new utterance or stop the guide
      if (reason === 'interrupted' || reason === 'canceled' || reason === 'cancelled') {
        resolve()
        return
      }
      if (generation !== speakGeneration) {
        resolve()
        return
      }
      reject(new Error(reason || 'Lecture vocale interrompue'))
    }

    window.speechSynthesis.speak(utterance)

    // Some Chromium builds need a kick after speak()
    window.setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume()
      } catch {
        // ignore
      }
    }, 50)
  })
}

export function stopSpeaking() {
  speakGeneration += 1
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}

/**
 * Map a TTS char index in `text` to the word token index from splitDisplayTokens.
 */
export function wordIndexFromCharIndex(text, displayTokens, charIndex) {
  if (!text || !displayTokens?.length) return -1
  let cursor = 0
  let wordOrdinal = -1
  let last = -1
  for (let i = 0; i < displayTokens.length; i += 1) {
    const token = displayTokens[i]
    if (token.type === 'word') {
      wordOrdinal += 1
      if (charIndex >= cursor && charIndex < cursor + token.value.length) return wordOrdinal
      if (cursor <= charIndex) last = wordOrdinal
    }
    cursor += token.value.length
  }
  return last
}

/**
 * Guided highlight while the learner reads (no TTS): advance word-by-word.
 * Returns a stop() function.
 */
export function startReadingGuide(wordCount, { wpm = 140, onWord, onDone } = {}) {
  if (wordCount <= 0) {
    onDone?.()
    return () => {}
  }
  const msPerWord = Math.max(280, Math.round(60000 / wpm))
  let index = 0
  onWord?.(0)
  const id = window.setInterval(() => {
    index += 1
    if (index >= wordCount) {
      window.clearInterval(id)
      onDone?.()
      return
    }
    onWord?.(index)
  }, msPerWord)
  return () => window.clearInterval(id)
}
