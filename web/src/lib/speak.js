let speakGeneration = 0
/** Learner-selected French voiceURI (persisted by the UI). */
let preferredFrenchVoiceURI = ''

export function setPreferredFrenchVoiceURI(voiceURI = '') {
  preferredFrenchVoiceURI = String(voiceURI || '')
}

export function getPreferredFrenchVoiceURI() {
  return preferredFrenchVoiceURI
}

const NATURAL_FR_NAMES =
  /am[eé]lie|thomas|audrey|marie|claire|daniel|virginie|hortense|sébastien|sebastien|google.*fran|eloquence|enhanced|premium|neural|natural|qualité|quality|siri/i

const ROBOTIC_FR_NAMES = /compact|espeak|festival|robot|novelty/i

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

/** Accent region label from BCP-47 lang (fr-FR → France). */
export function frenchAccentLabel(lang = '') {
  const code = String(lang).toLowerCase()
  if (code.includes('fr-ca') || code.includes('ca')) return 'Canada'
  if (code.includes('fr-be') || code.includes('be')) return 'Belgique'
  if (code.includes('fr-ch') || code.includes('ch')) return 'Suisse'
  if (code.startsWith('fr')) return 'France'
  return 'Français'
}

/** Higher = more natural French speaker for learners. */
export function scoreFrenchVoiceNaturalness(voice) {
  if (!voice) return -100
  const name = String(voice.name || '')
  const lang = String(voice.lang || '').toLowerCase()
  let score = 0
  if (lang.startsWith('fr')) score += 50
  if (lang === 'fr-fr' || lang.startsWith('fr-fr')) score += 20 // metropolitan FR accent
  if (NATURAL_FR_NAMES.test(name)) score += 30
  if (ROBOTIC_FR_NAMES.test(name)) score -= 40
  if (voice.localService) score += 5
  // Prefer non-default generic names slightly less
  if (/^french$/i.test(name.trim())) score -= 5
  return score
}

/**
 * List installed French system voices, best (most natural) first.
 * @returns {Promise<Array<{ voiceURI: string, name: string, lang: string, accent: string, natural: boolean, score: number }>>}
 */
export async function listFrenchVoices() {
  const voices = await loadVoices()
  const fr = voices.filter((v) => v.lang?.toLowerCase().startsWith('fr'))
  return fr
    .map((v) => {
      const score = scoreFrenchVoiceNaturalness(v)
      return {
        voiceURI: v.voiceURI,
        name: v.name,
        lang: v.lang,
        accent: frenchAccentLabel(v.lang),
        localService: Boolean(v.localService),
        natural: score >= 70,
        score,
      }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))
}

/**
 * Pick a French voice. Prefer `voiceURI` when provided and still installed.
 * Always stays on fr-* so the accent matches French (not English TTS).
 */
export async function pickFrenchVoice(voiceURI = preferredFrenchVoiceURI) {
  const voices = await loadVoices()
  const fr = voices.filter((v) => v.lang?.toLowerCase().startsWith('fr'))
  if (!fr.length) return null

  const wanted = voiceURI || preferredFrenchVoiceURI
  if (wanted) {
    const match = fr.find((v) => v.voiceURI === wanted || v.name === wanted)
    if (match) return match
  }

  const ranked = [...fr].sort(
    (a, b) => scoreFrenchVoiceNaturalness(b) - scoreFrenchVoiceNaturalness(a),
  )
  return ranked[0] || null
}

/**
 * Speak French text. Optional onBoundary(charIndex) for guided highlighting.
 * Pass `voiceURI` to force a French speaker (accent match).
 * Resolves with `{ status: 'ended' | 'interrupted' }` so callers can resume.
 */
export async function speakFrench(
  text,
  { rate = 0.7, onBoundary, voiceURI = preferredFrenchVoiceURI } = {},
) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('Synthèse vocale indisponible dans ce navigateur')
  }

  const generation = ++speakGeneration
  window.speechSynthesis.cancel()
  // Let the cancel settle (Chrome often fires "interrupted" otherwise)
  await new Promise((r) => window.setTimeout(r, 80))
  if (generation !== speakGeneration) return { status: 'interrupted' }

  // Chrome can leave the synth paused after cancel
  try {
    window.speechSynthesis.resume()
  } catch {
    // ignore
  }

  const voice = await pickFrenchVoice(voiceURI)
  if (generation !== speakGeneration) return { status: 'interrupted' }

  return new Promise((resolve, reject) => {
    if (generation !== speakGeneration) {
      resolve({ status: 'interrupted' })
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    // Force French language even if no fr voice is installed yet
    utterance.lang = voice?.lang?.toLowerCase().startsWith('fr') ? voice.lang : 'fr-FR'
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
      if (generation === speakGeneration) resolve({ status: 'ended' })
      else resolve({ status: 'interrupted' })
    }

    utterance.onerror = (event) => {
      const reason = event?.error || ''
      // Expected when we cancel to start a new utterance or stop the guide
      if (reason === 'interrupted' || reason === 'canceled' || reason === 'cancelled') {
        resolve({ status: 'interrupted' })
        return
      }
      if (generation !== speakGeneration) {
        resolve({ status: 'interrupted' })
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

/** Char offset of the start of wordOrdinal in display tokens (includes breaks/spaces). */
export function charIndexAtWord(displayTokens, wordOrdinal) {
  if (!displayTokens?.length || wordOrdinal < 0) return 0
  let cursor = 0
  let word = -1
  for (const token of displayTokens) {
    if (token.type === 'word') {
      word += 1
      if (word === wordOrdinal) return cursor
    }
    cursor += String(token.value ?? '').length
  }
  return cursor
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
