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
export async function speakFrench(text, { rate = 0.7, onBoundary } = {}) {
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

export const PACE_PRESETS = {
  lent: { wpm: 55, ttsRate: 0.58, label: 'Lent' },
  moyen: { wpm: 75, ttsRate: 0.68, label: 'Moyen' },
  rapide: { wpm: 105, ttsRate: 0.82, label: 'Rapide' },
  libre: { wpm: 0, ttsRate: 0.68, label: 'Libre' },
}

/**
 * Guided highlight while the learner reads (no TTS): advance word-by-word.
 * Returns a stop() function.
 */
export function startReadingGuide(wordCount, { wpm = 80, onWord, onDone } = {}) {
  if (wordCount <= 0) {
    onDone?.()
    return () => {}
  }
  const msPerWord = Math.max(550, Math.round(60000 / wpm))
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

/**
 * Highlight that follows the mic: advances while you speak, pauses when you pause.
 * Returns stop().
 */
export function startAdaptiveReadingGuide(
  wordCount,
  { stream, wpm = 75, onWord, onDone, silenceMs = 450, speechThreshold = 0.018 } = {},
) {
  if (wordCount <= 0) {
    onDone?.()
    return () => {}
  }

  const msPerWord = Math.max(500, Math.round(60000 / wpm))
  let index = 0
  let accrued = 0
  let lastTs = performance.now()
  let raf = 0
  let audioCtx = null
  let analyser = null
  let source = null
  const data = new Uint8Array(512)

  onWord?.(0)

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.7
    source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)
  } catch {
    // Fall back to fixed pace if Web Audio unavailable
    return startReadingGuide(wordCount, { wpm, onWord, onDone })
  }

  const tick = (now) => {
    const dt = now - lastTs
    lastTs = now

    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i += 1) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / data.length)
    const speaking = rms >= speechThreshold

    // Only advance while voice is present (pauses don't burn the timer)
    if (speaking) {
      accrued += dt
      while (accrued >= msPerWord && index < wordCount - 1) {
        accrued -= msPerWord
        index += 1
        onWord?.(index)
      }
      if (index >= wordCount - 1 && accrued >= msPerWord * 0.6) {
        cleanup()
        onDone?.()
        return
      }
    } else {
      // Soft decay so a short breath doesn't jump ahead after silence
      accrued = Math.max(0, accrued - dt * 0.35)
    }

    raf = window.requestAnimationFrame(tick)
  }

  const cleanup = () => {
    window.cancelAnimationFrame(raf)
    try {
      source?.disconnect()
      analyser?.disconnect()
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close()
    } catch {
      // ignore
    }
  }

  lastTs = performance.now()
  raf = window.requestAnimationFrame(tick)
  // Avoid unused silenceMs lint — keep as documented knobs for future tuning
  void silenceMs

  return cleanup
}

/**
 * Manual "libre" guide: start on word 0; caller advances with returned next/prev/stop.
 */
export function startManualReadingGuide(wordCount, { onWord, onDone } = {}) {
  let index = 0
  if (wordCount <= 0) {
    onDone?.()
    return { next: () => {}, prev: () => {}, stop: () => {}, getIndex: () => 0 }
  }
  onWord?.(0)
  return {
    getIndex: () => index,
    next: () => {
      if (index >= wordCount - 1) {
        onDone?.()
        return index
      }
      index += 1
      onWord?.(index)
      if (index >= wordCount - 1) onDone?.()
      return index
    },
    prev: () => {
      index = Math.max(0, index - 1)
      onWord?.(index)
      return index
    },
    stop: () => {},
  }
}
