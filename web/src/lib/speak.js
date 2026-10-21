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
  // Nudge Chrome/Opera to populate voices
  try {
    window.speechSynthesis.getVoices()
  } catch {
    // ignore
  }
  // Blink: first pointerdown primes speechSynthesis so later Écouter keeps activation.
  const unlock = () => {
    try {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.resume()
    } catch {
      // ignore
    }
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  return () => {
    window.speechSynthesis.removeEventListener('voiceschanged', onChange)
    window.removeEventListener('pointerdown', unlock)
  }
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
  // Prefer on-device voices — Opera/Chrome remote Google voices often stay silent offline.
  if (voice.localService) score += 25
  else score -= 10
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

/** Opera/Chrome (Blink) — Safari is WebKit and much more permissive. */
function isBlinkSpeechEngine() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // Opera stable uses OPR/; Opera GX too. Exclude iOS Opera Touch (uses WebKit).
  if (/OPR\/|Opera\//i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return true
  return /Chrome\//i.test(ua) && /Safari\//i.test(ua)
}

/** Desktop Opera — speechSynthesis is often silent; use Piper /tts instead. */
export function prefersServerTts() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /OPR\/|Opera\//i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)
}

let resumeKeepaliveId = 0
/** Active HTMLAudioElement from server TTS (Opera path). */
let activeServerAudio = null
let activeServerGuideId = 0
/** Word-highlight guide state for server TTS (so pause can stop and resume ticks). */
let serverGuideMeta = null
/** User pressed Pause — keepalive must not force-resume speechSynthesis. */
let speakingPaused = false
/** Generation used by the Blink resume keepalive (re-armed after user resume). */
let keepaliveGeneration = 0

function stopResumeKeepalive() {
  if (resumeKeepaliveId) {
    window.clearInterval(resumeKeepaliveId)
    resumeKeepaliveId = 0
  }
}

function clearServerGuideInterval() {
  if (activeServerGuideId) {
    window.clearInterval(activeServerGuideId)
    activeServerGuideId = 0
  }
}

function stopServerAudio() {
  clearServerGuideInterval()
  serverGuideMeta = null
  if (activeServerAudio) {
    try {
      activeServerAudio.pause()
      activeServerAudio.removeAttribute('src')
      activeServerAudio.load()
    } catch {
      // ignore
    }
    const src = activeServerAudio.dataset?.blobUrl
    if (src) {
      try {
        URL.revokeObjectURL(src)
      } catch {
        // ignore
      }
    }
    activeServerAudio = null
  }
}

/** Chrome/Opera freeze speechSynthesis after ~15s unless resume() is poked. */
function startResumeKeepalive(generation) {
  stopResumeKeepalive()
  keepaliveGeneration = generation
  if (!isBlinkSpeechEngine()) return
  resumeKeepaliveId = window.setInterval(() => {
    if (generation !== speakGeneration || speakingPaused) {
      if (generation !== speakGeneration) stopResumeKeepalive()
      return
    }
    try {
      const synth = window.speechSynthesis
      if (synth.speaking || synth.paused) synth.resume()
    } catch {
      // ignore
    }
  }, 5000)
}

function unlockSpeechSynth(synth) {
  if (speakingPaused) return
  try {
    if (synth.paused) synth.resume()
  } catch {
    // ignore
  }
}

function startServerGuideInterval() {
  clearServerGuideInterval()
  const meta = serverGuideMeta
  if (!meta || speakingPaused || typeof meta.onBoundary !== 'function') return
  if (!meta.words?.length) return
  activeServerGuideId = window.setInterval(() => {
    if (meta.generation !== speakGeneration || speakingPaused) {
      clearServerGuideInterval()
      if (meta.generation !== speakGeneration) {
        try {
          meta.audio?.pause()
        } catch {
          // ignore
        }
      }
      return
    }
    if (meta.wordIdx >= meta.words.length) {
      clearServerGuideInterval()
      return
    }
    const word = meta.words[meta.wordIdx]
    meta.onBoundary(word.index, word.length)
    meta.wordIdx += 1
  }, meta.stepMs)
}

function wordStartsInText(text) {
  const starts = []
  const re = /\S+/g
  let match
  while ((match = re.exec(text))) {
    starts.push({ index: match.index, length: match[0].length })
  }
  return starts
}

/**
 * Play one Piper WAV from the pronounce service (works in Opera).
 * Approximate word boundaries from duration for highlight sync.
 */
function speakOnceViaServer(text, { rate = 0.7, onBoundary } = {}) {
  return new Promise((resolve, reject) => {
    const generation = speakGeneration
    if (!text) {
      resolve({ status: 'ended' })
      return
    }

    const form = new FormData()
    form.append('text', text)
    form.append('lang', 'fr')

    fetch('/tts', { method: 'POST', body: form })
      .then(async (response) => {
        if (generation !== speakGeneration) {
          resolve({ status: 'interrupted' })
          return
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(
            detail?.slice(0, 180) ||
              `Voix serveur indisponible (${response.status}). Vérifiez Prononciation prête.`,
          )
        }
        return response.blob()
      })
      .then((blob) => {
        if (!blob || generation !== speakGeneration) {
          resolve({ status: 'interrupted' })
          return
        }
        stopServerAudio()
        speakingPaused = false
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.dataset.blobUrl = url
        audio.playbackRate = Math.min(1.4, Math.max(0.55, Number(rate) || 0.7))
        activeServerAudio = audio

        const words = wordStartsInText(text)

        const finish = (status) => {
          clearServerGuideInterval()
          if (serverGuideMeta?.audio === audio) serverGuideMeta = null
          try {
            URL.revokeObjectURL(url)
          } catch {
            // ignore
          }
          if (activeServerAudio === audio) activeServerAudio = null
          resolve({ status })
        }

        audio.onended = () => {
          finish(generation === speakGeneration ? 'ended' : 'interrupted')
        }
        audio.onerror = () => {
          finish('interrupted')
          reject(new Error('Lecture audio serveur impossible'))
        }

        const startGuide = () => {
          if (!words.length || typeof onBoundary !== 'function') return
          if (serverGuideMeta?.audio === audio && activeServerGuideId) return
          const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
          const effective = duration > 0 ? duration / audio.playbackRate : words.length * 0.45
          const stepMs = Math.max(180, (effective / words.length) * 1000)
          onBoundary(words[0].index, words[0].length)
          serverGuideMeta = {
            words,
            wordIdx: 1,
            stepMs,
            onBoundary,
            generation,
            audio,
          }
          if (!speakingPaused) startServerGuideInterval()
        }

        audio.onloadedmetadata = startGuide
        // Some browsers fire play before metadata — still start guide after play.
        const playPromise = audio.play()
        if (playPromise?.then) {
          playPromise
            .then(() => {
              if (!serverGuideMeta || serverGuideMeta.audio !== audio) startGuide()
            })
            .catch((err) => {
              finish('interrupted')
              reject(
                new Error(
                  err?.message ||
                    'Lecture bloquée. Cliquez Écouter une fois (geste utilisateur requis).',
                ),
              )
            })
        }
      })
      .catch((err) => {
        if (generation !== speakGeneration) {
          resolve({ status: 'interrupted' })
          return
        }
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}

async function speakFrenchViaServer(text, { rate = 0.7, onBoundary } = {}) {
  const generation = ++speakGeneration
  speakingPaused = false
  stopServerAudio()
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // ignore
  }

  const parts = splitTextForSpeech(text, 280)
  if (!parts.length) return { status: 'ended' }

  let offset = 0
  for (const part of parts) {
    if (generation !== speakGeneration) return { status: 'interrupted' }
    const chunkOffset = offset
    const result = await speakOnceViaServer(part, {
      rate,
      onBoundary: (charIndex, charLength) => {
        onBoundary?.(chunkOffset + charIndex, charLength)
      },
    })
    if (result.status === 'interrupted' || generation !== speakGeneration) {
      return { status: 'interrupted' }
    }
    const next = text.indexOf(part, offset)
    offset = next >= 0 ? next + part.length : offset + part.length
    while (offset < text.length && /\s/.test(text[offset])) offset += 1
  }
  return { status: generation === speakGeneration ? 'ended' : 'interrupted' }
}

/**
 * Queue one utterance. `assignVoice: false` uses lang only — Opera/Chrome
 * sometimes stay silent when .voice is set to a Mac enhanced voice.
 */
function speakOnce(text, { rate, onBoundary, voice, assignVoice = true }) {
  return new Promise((resolve, reject) => {
    const generation = speakGeneration
    if (!text) {
      resolve({ status: 'ended' })
      return
    }

    const liveVoice = voice
      ? pickFrenchVoiceSync(voice.voiceURI || voice.name) || voice
      : pickFrenchVoiceSync()

    const utterance = new SpeechSynthesisUtterance(text)
    const lang =
      liveVoice?.lang?.toLowerCase().startsWith('fr') ? liveVoice.lang : 'fr-FR'
    // Blink is picky about order: lang first, then optional voice.
    utterance.lang = lang
    utterance.rate = rate
    if (assignVoice && liveVoice) utterance.voice = liveVoice

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
      if (reason === 'not-allowed') {
        reject(
          new Error(
            'Ce navigateur bloque la voix (Opera/Chrome). Cliquez Tester la voix, ou autorisez le son pour ce site.',
          ),
        )
        return
      }
      reject(new Error(reason || 'Lecture vocale interrompue'))
    }

    const synth = window.speechSynthesis
    unlockSpeechSynth(synth)
    synth.speak(utterance)

    // Blink sometimes stays paused after cancel and never starts audio
    window.setTimeout(() => {
      try {
        if (generation === speakGeneration) unlockSpeechSynth(synth)
      } catch {
        // ignore
      }
    }, 16)
  })
}

/**
 * Speak French.
 * - Safari: system speechSynthesis (works well).
 * - Opera: Piper server TTS (/tts) — speechSynthesis is often silent there.
 * - Chrome: speechSynthesis first; falls back to server if needed.
 */
export async function speakFrench(
  text,
  { rate = 0.7, onBoundary, voiceURI = preferredFrenchVoiceURI, forceServer } = {},
) {
  if (!text || typeof window === 'undefined') {
    throw new Error('Synthèse vocale indisponible dans ce navigateur')
  }

  const useServer = forceServer === true || (forceServer !== false && prefersServerTts())
  if (useServer) {
    return speakFrenchViaServer(text, { rate, onBoundary })
  }

  if (!window.speechSynthesis) {
    // No browser TTS — try Piper
    return speakFrenchViaServer(text, { rate, onBoundary })
  }

  const synth = window.speechSynthesis
  const generation = ++speakGeneration
  speakingPaused = false
  const parts = splitTextForSpeech(text)
  if (!parts.length) return { status: 'ended' }

  // Replace in the SAME sync turn as speak — never await between cancel and
  // the first speak() (Opera/Chrome drop the utterance or lose activation).
  if (synth.speaking || synth.pending) {
    try {
      synth.cancel()
    } catch {
      // ignore
    }
  }
  unlockSpeechSynth(synth)
  startResumeKeepalive(generation)

  const runChunk = async (part, chunkOffset, assignVoice) => {
    const chunkVoice = pickFrenchVoiceSync(voiceURI)
    return speakOnce(part, {
      rate,
      voice: chunkVoice,
      assignVoice,
      onBoundary: (charIndex, charLength) => {
        onBoundary?.(chunkOffset + charIndex, charLength)
      },
    })
  }

  let offset = 0
  // Opera/Chrome: remote (non-local) voices often produce silence — start lang-only
  // unless the chosen voice is a local Mac/Windows voice.
  const initialVoice = pickFrenchVoiceSync(voiceURI)
  let preferLangOnly =
    isBlinkSpeechEngine() && initialVoice && initialVoice.localService === false

  try {
    for (let i = 0; i < parts.length; i += 1) {
      if (generation !== speakGeneration) return { status: 'interrupted' }
      const part = parts[i]
      const chunkOffset = offset

      let result
      try {
        result = await runChunk(part, chunkOffset, !preferLangOnly)
      } catch (err) {
        const msg = String(err?.message || err || '')
        // Retry once without .voice — common silent failure on Chrome + Mac voices
        if (
          !preferLangOnly &&
          i === 0 &&
          !/not-allowed/i.test(msg) &&
          generation === speakGeneration
        ) {
          preferLangOnly = true
          try {
            synth.cancel()
          } catch {
            // ignore
          }
          unlockSpeechSynth(synth)
          result = await runChunk(part, chunkOffset, false)
        } else if (i === 0 && generation === speakGeneration) {
          // Last resort: Piper server audio (same path as Opera)
          stopResumeKeepalive()
          return speakFrenchViaServer(text, { rate, onBoundary })
        } else {
          throw err
        }
      }

      if (result.status === 'interrupted' || generation !== speakGeneration) {
        return { status: 'interrupted' }
      }
      const next = text.indexOf(part, offset)
      offset = next >= 0 ? next + part.length : offset + part.length
      while (offset < text.length && /\s/.test(text[offset])) offset += 1
    }

    return { status: generation === speakGeneration ? 'ended' : 'interrupted' }
  } finally {
    if (generation === speakGeneration) stopResumeKeepalive()
  }
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
  speakingPaused = false
  stopResumeKeepalive()
  stopServerAudio()
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }
}

/** Pause active Écouter playback (system TTS and/or Opera Piper audio). */
export function pauseSpeaking() {
  if (speakingPaused) return
  speakingPaused = true
  clearServerGuideInterval()
  if (activeServerAudio) {
    try {
      activeServerAudio.pause()
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.pause()
      }
    } catch {
      // ignore
    }
  }
}

/** Resume after pauseSpeaking(). */
export function resumeSpeaking() {
  if (!speakingPaused) return
  speakingPaused = false
  if (activeServerAudio) {
    try {
      const playPromise = activeServerAudio.play()
      if (playPromise?.catch) playPromise.catch(() => {})
    } catch {
      // ignore
    }
    startServerGuideInterval()
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.resume()
    } catch {
      // ignore
    }
    if (keepaliveGeneration === speakGeneration) {
      startResumeKeepalive(speakGeneration)
    }
  }
}

export function isSpeakingPaused() {
  return speakingPaused
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
  const makeStop = (clear) => {
    const stop = () => clear()
    stop.pause = () => {}
    stop.resume = () => {}
    return stop
  }
  if (wordCount <= 0) {
    onDone?.()
    return makeStop(() => {})
  }
  const msPerWord = Math.max(550, Math.round(60000 / wpm))
  let index = 0
  let paused = false
  let id = 0
  onWord?.(0)
  id = window.setInterval(() => {
    if (paused) return
    index += 1
    if (index >= wordCount) {
      window.clearInterval(id)
      id = 0
      onDone?.()
      return
    }
    onWord?.(index)
  }, msPerWord)
  const stop = () => {
    if (id) window.clearInterval(id)
    id = 0
  }
  stop.pause = () => {
    paused = true
  }
  stop.resume = () => {
    paused = false
  }
  return stop
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
