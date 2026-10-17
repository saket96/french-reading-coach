let speakGeneration = 0
/** Learner-selected French voiceURI (persisted by the UI). */
let preferredFrenchVoiceURI = ''
/** Cached SpeechSynthesisVoice list — keep sync so speak() stays in the click gesture. */
let cachedVoices = []

export function setPreferredFrenchVoiceURI(voiceURI = '') {
  preferredFrenchVoiceURI = String(voiceURI || '')
}

export function getPreferredFrenchVoiceURI() {
  return preferredFrenchVoiceURI
}

const NATURAL_FR_NAMES =
  /am[eé]lie|thomas|audrey|marie|claire|daniel|virginie|hortense|sébastien|sebastien|google.*fran|eloquence|enhanced|premium|neural|natural|qualité|quality|siri/i

const ROBOTIC_FR_NAMES = /compact|espeak|festival|robot|novelty/i

function syncVoiceCache() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return cachedVoices
  try {
    // Always prefer a fresh getVoices() list — cached SpeechSynthesisVoice
    // objects go stale and Chrome/Safari then speak silently.
    const list = window.speechSynthesis.getVoices()
    if (list?.length) cachedVoices = [...list]
  } catch {
    // ignore
  }
  return cachedVoices
}

function freshVoices() {
  return syncVoiceCache()
}

/** Call once on app boot so voices are ready before the first Écouter click. */
export function warmSpeechVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return () => {}
  syncVoiceCache()
  const onChange = () => syncVoiceCache()
  window.speechSynthesis.addEventListener('voiceschanged', onChange)
  // Nudge Chrome to populate voices
  try {
    window.speechSynthesis.getVoices()
  } catch {
    // ignore
  }
  return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange)
}

function loadVoices() {
  const now = syncVoiceCache()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(syncVoiceCache())
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(syncVoiceCache())
    }, 400)
  })
}

/** Accent region label from BCP-47 lang (fr-FR → France). */
export function frenchAccentLabel(lang = '') {
  const code = String(lang).toLowerCase()
  if (code.includes('fr-ca') || code.endsWith('-ca')) return 'Canada'
  if (code.includes('fr-be') || code.endsWith('-be')) return 'Belgique'
  if (code.includes('fr-ch') || code.endsWith('-ch')) return 'Suisse'
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
  if (lang === 'fr-fr' || lang.startsWith('fr-fr')) score += 20
  if (NATURAL_FR_NAMES.test(name)) score += 30
  if (ROBOTIC_FR_NAMES.test(name)) score -= 40
  if (voice.localService) score += 5
  if (/^french$/i.test(name.trim())) score -= 5
  return score
}

function toVoiceOption(v) {
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
}

/**
 * List installed French system voices, best (most natural) first.
 */
export async function listFrenchVoices() {
  const voices = await loadVoices()
  return voices
    .filter((v) => v.lang?.toLowerCase().startsWith('fr'))
    .map(toVoiceOption)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))
}

/** Sync pick from a fresh getVoices() snapshot — never await before speak(). */
export function pickFrenchVoiceSync(voiceURI = preferredFrenchVoiceURI) {
  const voices = freshVoices()
  const fr = voices.filter((v) => v.lang?.toLowerCase().startsWith('fr'))
  if (!fr.length) return null

  const wanted = voiceURI || preferredFrenchVoiceURI
  if (wanted) {
    const match = fr.find((v) => v.voiceURI === wanted || v.name === wanted)
    if (match) return match
  }

  return (
    [...fr].sort((a, b) => scoreFrenchVoiceNaturalness(b) - scoreFrenchVoiceNaturalness(a))[0] ||
    null
  )
}

export async function pickFrenchVoice(voiceURI = preferredFrenchVoiceURI) {
  await loadVoices()
  return pickFrenchVoiceSync(voiceURI)
}

/** Chrome often stops long utterances — keep chunks short. */
export function splitTextForSpeech(text, maxLen = 180) {
  const raw = String(text ?? '').trim()
  if (!raw) return []
  if (raw.length <= maxLen) return [raw]

  const sentences = raw.split(/(?<=[.!?…])\s+/).filter(Boolean)
  const parts = []
  let buf = ''
  for (const sentence of sentences.length ? sentences : [raw]) {
    if (!buf) {
      buf = sentence
      continue
    }
    if (`${buf} ${sentence}`.length <= maxLen) {
      buf = `${buf} ${sentence}`
    } else {
      parts.push(buf)
      buf = sentence
    }
  }
  if (buf) parts.push(buf)

  // Hard-wrap any leftover long piece
  const out = []
  for (const part of parts) {
    if (part.length <= maxLen) {
      out.push(part)
      continue
    }
    let i = 0
    while (i < part.length) {
      out.push(part.slice(i, i + maxLen))
      i += maxLen
    }
  }
  return out
}

function speakOnce(text, { rate, onBoundary, voice }) {
  return new Promise((resolve, reject) => {
    const generation = speakGeneration
    if (!text) {
      resolve({ status: 'ended' })
      return
    }

    // Re-resolve by URI so we never assign a stale Voice object.
    const liveVoice = voice
      ? pickFrenchVoiceSync(voice.voiceURI || voice.name) || voice
      : pickFrenchVoiceSync()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = liveVoice?.lang?.toLowerCase().startsWith('fr')
      ? liveVoice.lang
      : 'fr-FR'
    utterance.rate = rate
    if (liveVoice) utterance.voice = liveVoice

    if (typeof onBoundary === 'function') {
      utterance.onboundary = (event) => {
        if (generation !== speakGeneration) return
        if (event.name === 'word' || event.name === 'Sentence' || !event.name) {
          onBoundary(event.charIndex ?? 0, event.charLength ?? 0)
        }
      }
    }

    utterance.onend = () => {
      resolve({ status: generation === speakGeneration ? 'ended' : 'interrupted' })
    }

    utterance.onerror = (event) => {
      const reason = event?.error || ''
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

    const synth = window.speechSynthesis
    try {
      if (synth.paused) synth.resume()
    } catch {
      // ignore
    }
    synth.speak(utterance)

    // Chrome sometimes stays paused after cancel and never starts audio
    window.setTimeout(() => {
      try {
        if (generation === speakGeneration && (synth.paused || !synth.speaking)) {
          synth.resume()
        }
      } catch {
        // ignore
      }
    }, 30)
  })
}

/**
 * Speak French with a French accent voice when available.
 * Speaks in short chunks (Chrome-safe). Cancels only when needed, and never
 * awaits before the first speak() when the synth is already idle — that
 * delay was silencing Chrome after the voice picker.
 */
export async function speakFrench(
  text,
  { rate = 0.7, onBoundary, voiceURI = preferredFrenchVoiceURI } = {},
) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('Synthèse vocale indisponible dans ce navigateur')
  }

  const synth = window.speechSynthesis
  const generation = ++speakGeneration
  const voice = pickFrenchVoiceSync(voiceURI)

  const parts = splitTextForSpeech(text)
  if (!parts.length) return { status: 'ended' }

  const needsCancel = synth.speaking || synth.pending
  if (needsCancel) {
    try {
      synth.cancel()
    } catch {
      // ignore
    }
    // Chrome drops speak() in the same turn as cancel(); brief yield only then.
    await new Promise((r) => window.setTimeout(r, 50))
    if (generation !== speakGeneration) return { status: 'interrupted' }
  }

  try {
    synth.resume()
  } catch {
    // ignore
  }

  let offset = 0

  for (const part of parts) {
    if (generation !== speakGeneration) return { status: 'interrupted' }
    const chunkOffset = offset
    // Fresh voice each chunk (Voice objects can go stale mid-session)
    const chunkVoice = pickFrenchVoiceSync(voiceURI) || voice
    const result = await speakOnce(part, {
      rate,
      voice: chunkVoice,
      onBoundary: (charIndex, charLength) => {
        onBoundary?.(chunkOffset + charIndex, charLength)
      },
    })
    if (result.status === 'interrupted' || generation !== speakGeneration) {
      return { status: 'interrupted' }
    }
    // Keep original spacing when advancing offset through the full string
    const next = text.indexOf(part, offset)
    offset = next >= 0 ? next + part.length : offset + part.length
    // Skip following whitespace so boundary mapping stays aligned
    while (offset < text.length && /\s/.test(text[offset])) offset += 1
  }

  return { status: generation === speakGeneration ? 'ended' : 'interrupted' }
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
