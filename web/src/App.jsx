import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  CircleStop,
  Database,
  Languages,
  Layers,
  Mic,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import { Button } from './components/ui/button.jsx'
import { VocabDeck } from './components/VocabDeck.jsx'
import { WorksPanel } from './components/WorksPanel.jsx'
import { FIXTURE_CHUNK_INDEX, FIXTURE_PASSAGE_ID, FIXTURE_TRANSCRIPT } from './fixtures.js'
import { alignWords, practiceErrors } from './lib/align.js'
import { findTimingForHyp, playAudioRange } from './lib/audioClip.js'
import { passageChunks } from './lib/chunks.js'
import { CUSTOM_PASSAGE_ID, customPassage, loadCustomText, saveCustomText } from './lib/customText.js'
import { analyzeLiaisons, analyzeTerminations } from './lib/liaison.js'
import {
  assessFrenchPronunciation,
  checkPronounceReady,
  extractPronunciationTips,
  PronounceUnavailableError,
} from './lib/pronounce.js'
import {
  MIN_AUDIO_BLOB_BYTES,
  pickRecorderMimeType,
  stopRecorderToBlob,
} from './lib/recordAudio.js'
import { buildFocusReview } from './lib/review.js'
import { countGuidedWords } from './lib/guided.js'
import {
  charIndexAtWord,
  listFrenchVoices,
  PACE_PRESETS,
  setPreferredFrenchVoiceURI,
  speakFrench,
  startReadingGuide,
  stopSpeaking,
  warmSpeechVoices,
  wordIndexFromCharIndex,
} from './lib/speak.js'
import {
  sentenceTextFromTokens,
  splitDisplayTokensWithSentences,
} from './lib/sentences.js'
import { splitDisplayTokens, tokenizeFrench } from './lib/tokenize.js'
import { reversoContextUrl, translateFrenchToEnglish } from './lib/translate.js'
import {
  loadVocabulary,
  removeVocabularyEntry,
  saveVocabulary,
  upsertVocabularyEntry,
} from './lib/vocabulary.js'
import { checkWhisperReady } from './lib/whisperHealth.js'
import { transcribeFrenchAudio, WhisperUnavailableError } from './lib/whisper.js'
import { passages } from './passages.js'

const PASS_THRESHOLD = 0.7
const CLICK_LEARN_KEY = 'frc-click-learn'
const CLICK_TARGET_KEY = 'frc-click-target'
const PACE_KEY = 'frc-speaking-pace'
const VOICE_KEY = 'frc-french-voice'
const MODEL_KEY = 'frc-whisper-model'
const SHADOW_KEY = 'frc-shadow-mode'

function loadClickLearn() {
  try {
    const raw = localStorage.getItem(CLICK_LEARN_KEY)
    if (raw === null) return false
    return raw === '1' || raw === 'true'
  } catch {
    return false
  }
}

function loadClickTarget() {
  try {
    const raw = localStorage.getItem(CLICK_TARGET_KEY)
    if (raw === 'phrase' || raw === 'word') return raw
  } catch {
    // ignore
  }
  return 'word'
}

function loadPace() {
  try {
    const raw = localStorage.getItem(PACE_KEY)
    // "libre" was for recording guides; listening only uses lent/moyen/rapide
    if (raw && raw !== 'libre' && PACE_PRESETS[raw]) return raw
  } catch {
    // ignore
  }
  return 'moyen'
}

function loadModel() {
  try {
    const raw = localStorage.getItem(MODEL_KEY)
    if (raw === 'small' || raw === 'base') return raw
  } catch {
    // ignore
  }
  return 'base'
}

function loadShadow() {
  try {
    return localStorage.getItem(SHADOW_KEY) === '1'
  } catch {
    return false
  }
}

function loadVoiceURI() {
  try {
    return localStorage.getItem(VOICE_KEY) || ''
  } catch {
    return ''
  }
}

function scoreLabel(score) {
  return `${Math.round(score * 100)} %`
}

function FeedbackChips({ ops, onWordClick }) {
  if (!ops.length) {
    return <p className="text-sm text-muted-foreground">Aucun mot à comparer pour l’instant.</p>
  }

  return (
    <p className="flex flex-wrap gap-1.5">
      {ops.map((op, index) => {
        const word = op.target || op.hyp
        const clickable = Boolean(word && onWordClick)
        const common =
          'rounded-md px-1.5 py-0.5 text-sm transition-colors ' +
          (clickable ? 'cursor-pointer hover:ring-2 hover:ring-ring/40' : '')

        if (op.type === 'match') {
          return (
            <span
              key={`${op.type}-${index}`}
              className={`${common} bg-emerald-100 text-match`}
              onClick={() => clickable && onWordClick(word)}
              title="Cliquer pour traduire / vocabulaire"
            >
              {op.target}
            </span>
          )
        }
        if (op.type === 'close') {
          return (
            <span
              key={`${op.type}-${index}`}
              className={`${common} bg-amber-100 text-amber-900`}
              title={`presque (entendu : ${op.hyp}) — accent, genre ou variante ASR`}
              onClick={() => clickable && onWordClick(op.target)}
            >
              {op.target}
            </span>
          )
        }
        if (op.type === 'wrong') {
          return (
            <span
              key={`${op.type}-${index}`}
              className={`${common} bg-red-100 text-wrong`}
              title={`entendu : ${op.hyp} — cliquer pour traduire`}
              onClick={() => clickable && onWordClick(op.target)}
            >
              {op.target}
            </span>
          )
        }
        if (op.type === 'missing') {
          return (
            <span
              key={`${op.type}-${index}`}
              className={`${common} bg-red-100 text-wrong line-through`}
              onClick={() => clickable && onWordClick(op.target)}
            >
              {op.target}
            </span>
          )
        }
        return (
          <span
            key={`${op.type}-${index}`}
            className={`${common} bg-zinc-200 text-extra`}
            onClick={() => clickable && onWordClick(op.hyp)}
          >
            +{op.hyp}
          </span>
        )
      })}
    </p>
  )
}

export default function App() {
  const [sourceMode, setSourceMode] = useState('library')
  const [passageId, setPassageId] = useState(passages[0].id)
  const [customDraft, setCustomDraft] = useState(() => loadCustomText())
  const [customText, setCustomText] = useState(() => loadCustomText())
  const [chunkIndex, setChunkIndex] = useState(0)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState('')
  const [timedWords, setTimedWords] = useState([])
  const [audioUrl, setAudioUrl] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [pronounceTips, setPronounceTips] = useState(null)
  const [pronounceNote, setPronounceNote] = useState('')
  const [vocab, setVocab] = useState(() => loadVocabulary())
  const [lookupWord, setLookupWord] = useState('')
  const [lookupResult, setLookupResult] = useState(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [showVocab, setShowVocab] = useState(false)
  const [showDeck, setShowDeck] = useState(false)
  const [showWorks, setShowWorks] = useState(false)
  const [activeWorkId, setActiveWorkId] = useState('')
  const [activeWorkTitle, setActiveWorkTitle] = useState('')
  const [guideWordIndex, setGuideWordIndex] = useState(-1)
  const [guideMode, setGuideMode] = useState('') // 'listen' | 'listen-all' | 'read' | ''
  const [clickLearn, setClickLearn] = useState(() => loadClickLearn())
  const [clickTarget, setClickTarget] = useState(() => loadClickTarget()) // word | phrase
  const [selectedSentence, setSelectedSentence] = useState(-1)
  const [pace, setPace] = useState(() => loadPace())
  const [voiceURI, setVoiceURI] = useState(() => loadVoiceURI())
  const [frenchVoices, setFrenchVoices] = useState([])
  const [whisperModel, setWhisperModel] = useState(() => loadModel())
  const [whisperReady, setWhisperReady] = useState('checking') // checking | ready | down
  const [pronounceReady, setPronounceReady] = useState('checking') // checking | ready | down
  const [shadowMode, setShadowMode] = useState(() => loadShadow())
  const [shadowHeard, setShadowHeard] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const guideStopRef = useRef(null)
  /** Active listen session so a click-explain can resume from the interrupt point. */
  const listenSessionRef = useRef(null)

  const paceConfig = PACE_PRESETS[pace] || PACE_PRESETS.moyen

  const activePassage = useMemo(() => {
    if (sourceMode === 'custom') return customPassage(customText)
    return passages.find((item) => item.id === passageId) ?? passages[0]
  }, [sourceMode, customText, passageId])

  const chunks = useMemo(() => {
    if (!activePassage.text?.trim()) return []
    return passageChunks(activePassage.text, shadowMode ? 1 : 2)
  }, [activePassage.text, shadowMode])

  const safeIndex = Math.min(chunkIndex, Math.max(chunks.length - 1, 0))
  const currentChunk = chunks[safeIndex] ?? ''
  const isLastChunk = chunks.length === 0 || safeIndex >= chunks.length - 1
  const displayTokens = useMemo(() => splitDisplayTokens(currentChunk || ''), [currentChunk])
  const wordCount = useMemo(() => countGuidedWords(currentChunk || ''), [currentChunk])
  const fullText = activePassage?.text?.trim() || ''
  const fullDisplayTokens = useMemo(
    () => splitDisplayTokensWithSentences(fullText),
    [fullText],
  )
  const fullWordCount = useMemo(() => countGuidedWords(fullText), [fullText])
  // Word offset of the current step inside the full passage (always show full text).
  const chunkWordOffset = useMemo(() => {
    if (!chunks.length || safeIndex <= 0) return 0
    const prefix = chunks.slice(0, safeIndex).join(' ')
    return countGuidedWords(prefix)
  }, [chunks, safeIndex])
  const listeningAll = guideMode === 'listen-all'
  const listeningStep = guideMode === 'listen'

  const alignment = useMemo(() => {
    if (!transcript || !currentChunk) return null
    return alignWords(tokenizeFrench(currentChunk), tokenizeFrench(transcript))
  }, [currentChunk, transcript])

  const liaisonAnalysis = useMemo(() => {
    if (!transcript || !currentChunk) return { sites: [], issues: [] }
    return analyzeLiaisons(currentChunk, transcript, alignment?.ops ?? [])
  }, [currentChunk, transcript, alignment])

  const terminationIssues = useMemo(
    () => analyzeTerminations(alignment?.ops ?? []),
    [alignment],
  )

  const focusReview = useMemo(() => {
    if (!alignment) return null
    return buildFocusReview({
      alignment,
      liaisonSites: liaisonAnalysis.sites,
      liaisonIssues: liaisonAnalysis.issues,
      terminationIssues,
      pronounceTips,
    })
  }, [alignment, liaisonAnalysis, terminationIssues, pronounceTips])

  const wordPass = (alignment?.score ?? 0) >= PASS_THRESHOLD
  const canAdvance = phase === 'done' && Boolean(transcript) && !isLastChunk

  useEffect(() => {
    saveVocabulary(vocab)
  }, [vocab])

  useEffect(() => {
    try {
      localStorage.setItem(CLICK_LEARN_KEY, clickLearn ? '1' : '0')
    } catch {
      // ignore
    }
  }, [clickLearn])

  useEffect(() => {
    try {
      localStorage.setItem(CLICK_TARGET_KEY, clickTarget)
    } catch {
      // ignore
    }
  }, [clickTarget])

  useEffect(() => {
    try {
      localStorage.setItem(PACE_KEY, pace)
    } catch {
      // ignore
    }
  }, [pace])

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_KEY, voiceURI)
    } catch {
      // ignore
    }
    setPreferredFrenchVoiceURI(voiceURI)
  }, [voiceURI])

  useEffect(() => {
    const stopWarm = warmSpeechVoices()
    let cancelled = false
    const refreshVoices = async () => {
      const list = await listFrenchVoices()
      if (cancelled) return
      setFrenchVoices(list)
      setVoiceURI((current) => {
        if (!list.length) return current
        if (current && list.some((v) => v.voiceURI === current)) return current
        const best =
          list.find((v) => v.natural && v.accent === 'France') ||
          list.find((v) => v.natural) ||
          list[0]
        return best?.voiceURI || current
      })
    }
    refreshVoices()
    const onVoices = () => refreshVoices()
    window.speechSynthesis?.addEventListener?.('voiceschanged', onVoices)
    return () => {
      cancelled = true
      stopWarm?.()
      window.speechSynthesis?.removeEventListener?.('voiceschanged', onVoices)
    }
  }, [])

  /** Keep the highlighted word on screen while long passages are spoken. */
  useEffect(() => {
    if (guideWordIndex < 0) return
    if (guideMode !== 'listen' && guideMode !== 'listen-all' && guideMode !== 'read') return
    const el = document.querySelector(`[data-guide-word="${guideWordIndex}"]`)
    if (!el) return
    // Only scroll when the word is outside (or near) the viewport — avoids jitter.
    const rect = el.getBoundingClientRect()
    const margin = Math.round(window.innerHeight * 0.22)
    const inComfort =
      rect.top >= margin && rect.bottom <= window.innerHeight - margin
    if (inComfort) return
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  }, [guideWordIndex, guideMode])

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_KEY, whisperModel)
    } catch {
      // ignore
    }
  }, [whisperModel])

  useEffect(() => {
    try {
      localStorage.setItem(SHADOW_KEY, shadowMode ? '1' : '0')
    } catch {
      // ignore
    }
  }, [shadowMode])

  const selectWhisperModel = (model) => {
    setWhisperModel(model)
    setWhisperReady('checking')
  }

  const refreshWhisperStatus = async () => {
    setWhisperReady('checking')
    const result = await checkWhisperReady(whisperModel)
    setWhisperReady(result.ready ? 'ready' : 'down')
  }

  /** Clear stuck pronounce UI + re-ping OpenPronounce (helps Opera flaky sessions). */
  const resetPronounceStatus = async () => {
    setPronounceTips(null)
    setPronounceNote('')
    setPronounceReady('checking')
    const result = await checkPronounceReady()
    setPronounceReady(result.ready ? 'ready' : 'down')
    if (!result.ready) {
      setPronounceNote(
        'Prononciation indisponible. Lancez `docker compose up -d --build pronounce`, attendez le voyant vert, puis réenregistrez.',
      )
    }
  }

  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      const result = await checkWhisperReady(whisperModel)
      if (!cancelled) setWhisperReady(result.ready ? 'ready' : 'down')
    }
    ping()
    const id = window.setInterval(ping, 10000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [whisperModel])

  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      const result = await checkPronounceReady()
      if (!cancelled) setPronounceReady(result.ready ? 'ready' : 'down')
    }
    ping()
    const id = window.setInterval(ping, 10000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  /** Clear guide UI/session without cancelling TTS (speakFrench handles replace). */
  const clearGuideSession = () => {
    if (listenSessionRef.current) listenSessionRef.current.stopped = true
    listenSessionRef.current = null
    guideStopRef.current?.()
    guideStopRef.current = null
    setGuideWordIndex(-1)
    setGuideMode('')
  }

  const stopGuide = () => {
    clearGuideSession()
    stopSpeaking()
  }

  const finishListenSession = (session) => {
    if (listenSessionRef.current !== session) return
    listenSessionRef.current = null
    guideStopRef.current?.()
    guideStopRef.current = null
    setGuideWordIndex(-1)
    setGuideMode('')
  }

  /** Play (or resume) a listen session from an absolute char index in session.text. */
  const playListenSession = async (session, fromChar = 0) => {
    if (!session || session.stopped) return
    listenSessionRef.current = session
    setGuideMode(session.mode)
    setError('')

    const start = Math.max(0, Math.min(fromChar, session.text.length))
    const slice = session.text.slice(start)
    if (!slice.trim()) {
      finishListenSession(session)
      return
    }

    let gotBoundary = false
    const fallbackTimer = window.setTimeout(() => {
      if (gotBoundary || guideStopRef.current || listenSessionRef.current !== session) return
      const startWord = Math.max(0, session.lastWordIndex || 0)
      const remainingWords = Math.max(0, session.wordCount - startWord)
      guideStopRef.current = startReadingGuide(remainingWords, {
        wpm: listenWpmForPace(),
        onWord: (index) => {
          const abs = startWord + index
          session.lastWordIndex = abs
          setGuideWordIndex(session.wordOffset + abs)
        },
        onDone: () => {
          guideStopRef.current = null
          finishListenSession(session)
        },
      })
    }, 900)

    try {
      // Highlight first word immediately so the UI reacts even if TTS is slow
      setGuideWordIndex(session.wordOffset + Math.max(0, session.lastWordIndex || 0))
      const result = await speakFrench(slice, {
        rate: session.rate,
        voiceURI: session.voiceURI || voiceURI,
        onBoundary: (charIndex) => {
          if (listenSessionRef.current !== session) return
          gotBoundary = true
          window.clearTimeout(fallbackTimer)
          guideStopRef.current?.()
          guideStopRef.current = null
          const absChar = start + charIndex
          session.lastCharIndex = absChar
          const idx = wordIndexFromCharIndex(session.text, session.tokens, absChar)
          if (idx >= 0) {
            session.lastWordIndex = idx
            setGuideWordIndex(session.wordOffset + idx)
          }
        },
      })
      window.clearTimeout(fallbackTimer)
      if (listenSessionRef.current !== session || session.stopped) return
      if (session.holdForLookup) return
      if (result?.status === 'interrupted') {
        // Interrupted by another speak/stop — don't clear UI mid-lookup
        return
      }
      if (!guideStopRef.current) finishListenSession(session)
    } catch (err) {
      window.clearTimeout(fallbackTimer)
      if (listenSessionRef.current !== session || session.stopped || session.holdForLookup) return
      if (!guideStopRef.current) {
        const startWord = Math.max(0, session.lastWordIndex || 0)
        const remainingWords = Math.max(0, session.wordCount - startWord)
        guideStopRef.current = startReadingGuide(remainingWords, {
          wpm: listenWpmForPace(),
          onWord: (index) => {
            const abs = startWord + index
            session.lastWordIndex = abs
            setGuideWordIndex(session.wordOffset + abs)
          },
          onDone: () => {
            guideStopRef.current = null
            finishListenSession(session)
          },
        })
      }
      setError(
        err?.message ||
          'La voix française n’a pas démarré. Choisissez une voix dans le panneau (Voix française), ou téléchargez Amélie/Thomas : Réglages → Accessibilité → Contenu lu à voix haute.',
      )
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      guideStopRef.current?.()
      stopSpeaking()
    }
  }, [audioUrl])

  const clearAttemptAudio = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl('')
    }
  }

  const resetAttempt = () => {
    setPhase('idle')
    setError('')
    setTranscript('')
    setTimedWords([])
    setSeconds(0)
    setPronounceTips(null)
    setPronounceNote('')
    clearAttemptAudio()
    stopGuide()
  }

  const applyCustomText = () => {
    const trimmed = customDraft.trim()
    if (!trimmed) {
      setError('Collez ou écrivez un texte français avant de continuer.')
      return
    }
    saveCustomText(trimmed)
    setCustomText(trimmed)
    setSourceMode('custom')
    setChunkIndex(0)
    resetAttempt()
    setError('')
  }

  const openWorksPanel = () => {
    setShowWorks(true)
    setShowVocab(false)
    setShowDeck(false)
  }

  const loadSavedWork = (work) => {
    if (!work?.text) return
    const text = String(work.text).trim()
    saveCustomText(text)
    setCustomDraft(text)
    setCustomText(text)
    setSourceMode('custom')
    setActiveWorkId(work.id || '')
    setActiveWorkTitle(work.title || '')
    setChunkIndex(0)
    resetAttempt()
    setError('')
    setShowWorks(false)
  }

  const onWorkSaved = (record) => {
    if (!record) {
      setActiveWorkId('')
      setActiveWorkTitle('')
      return
    }
    setActiveWorkId(record.id)
    setActiveWorkTitle(record.title)
  }

  const onPassageChange = (nextId) => {
    setPassageId(nextId)
    setSourceMode('library')
    setChunkIndex(0)
    resetAttempt()
  }

  const goNextChunk = () => {
    if (isLastChunk) return
    setChunkIndex((value) => value + 1)
    setShadowHeard(false)
    resetAttempt()
  }

  const toggleShadowMode = () => {
    setShadowMode((value) => !value)
    setChunkIndex(0)
    setShadowHeard(false)
    resetAttempt()
  }

  const startTimer = () => {
    setSeconds(0)
    timerRef.current = window.setInterval(() => {
      setSeconds((value) => value + 1)
    }, 1000)
  }

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startRecording = async () => {
    setError('')
    setTranscript('')
    setTimedWords([])
    setPronounceTips(null)
    setPronounceNote('')
    stopGuide()
    if (!currentChunk) {
      setError('Ajoutez un texte ou choisissez un passage avant d’enregistrer.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(
        'L’enregistrement n’est pas disponible dans ce navigateur. Utilisez Chrome ou Edge, ou lancez la démo sans micro.',
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })
      streamRef.current = stream
      const mimeType = pickRecorderMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data)
      }
      // Timeslice keeps Opera/Chrome from delivering one truncated WebM on stop.
      recorder.start(1000)
      startTimer()
      setPhase('recording')
      // Record at your own pace — feedback comes after Stop
      stopGuide()
    } catch {
      setError(
        'Micro refusé ou indisponible. Autorisez le micro (Opera/Chrome/Edge), ou utilisez la démo sans micro.',
      )
      setPhase('idle')
    }
  }

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current
    const stream = streamRef.current
    if (!recorder || (recorder.state !== 'recording' && recorder.state !== 'paused')) return

    stopTimer()
    stopGuide()
    setPhase('transcribing')

    try {
      const blob = await stopRecorderToBlob(recorder, chunksRef.current)
      stream?.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null

      if (!blob || blob.size < MIN_AUDIO_BLOB_BYTES) {
        setError(
          'Enregistrement trop court ou incomplet (souvent sous Opera). Gardez Stop 1–2 s après avoir parlé, puis réessayez.',
        )
        setPhase('error')
        return
      }

      clearAttemptAudio()
      setAudioUrl(URL.createObjectURL(blob))

      try {
        const result = await transcribeFrenchAudio(blob, { model: whisperModel })
        if (!result.text) {
          setError('Whisper n’a renvoyé aucun texte. Réessayez en parlant plus près du micro.')
          setPhase('error')
          return
        }
        setTranscript(result.text)
        setTimedWords(result.words ?? [])
        setPhase('done')

        try {
          const raw = await assessFrenchPronunciation(blob, currentChunk)
          setPronounceTips(extractPronunciationTips(raw))
          setPronounceNote('')
        } catch (err) {
          setPronounceTips(null)
          setPronounceNote(
            err instanceof PronounceUnavailableError
              ? err.message
              : 'Évaluation phonétique indisponible pour ce tour. Réessayez — sous Opera le premier essai échoue parfois.',
          )
        }
      } catch (err) {
        setError(
          err instanceof WhisperUnavailableError
            ? err.message
            : 'La transcription a échoué. Vérifiez Docker puis réessayez.',
        )
        setPhase('error')
      }
    } catch {
      stream?.getTracks().forEach((track) => track.stop())
      setError('Impossible de finaliser l’enregistrement. Réessayez sous Opera, ou utilisez Chrome.')
      setPhase('error')
    }
  }

  const runFixture = () => {
    setError('')
    setSourceMode('library')
    setPassageId(FIXTURE_PASSAGE_ID)
    setChunkIndex(FIXTURE_CHUNK_INDEX)
    setTranscript(FIXTURE_TRANSCRIPT)
    setTimedWords([])
    setPronounceTips({
      score: 68,
      errors: [
        { word: 'privilège', expected: 'pʁivilɛʒ', actual: 'pʁivilɛdʒ', confidence: 0.82 },
        { word: 'domicile', expected: 'dɔmisil', actual: 'mɛzɔ̃', confidence: 0.7 },
      ],
      transcript: FIXTURE_TRANSCRIPT,
    })
    setPronounceNote('')
    setPhase('done')
  }

  const listenRateForPace = () =>
    pace === 'libre' ? PACE_PRESETS.moyen.ttsRate : paceConfig.ttsRate

  const listenWpmForPace = () =>
    pace === 'libre' ? PACE_PRESETS.moyen.wpm : paceConfig.wpm

  /** Speak the full passage with word highlight across the whole text. */
  const listenFullPassage = async () => {
    const text = fullText
    if (!text) return
    // Soft clear only — do not cancel() here; a cancel+await before speak
    // leaves Chrome/Safari silent after the voice picker.
    clearGuideSession()
    const session = {
      mode: 'listen-all',
      text,
      tokens: fullDisplayTokens,
      rate: listenRateForPace(),
      voiceURI,
      wordOffset: 0,
      wordCount: fullWordCount,
      lastCharIndex: 0,
      lastWordIndex: 0,
      holdForLookup: false,
      stopped: false,
    }
    await playListenSession(session, 0)
  }

  const listenChunk = async () => {
    if (!currentChunk) return
    clearGuideSession()
    setShadowHeard(true)
    const session = {
      mode: 'listen',
      text: currentChunk,
      tokens: displayTokens,
      rate: listenRateForPace(),
      voiceURI,
      wordOffset: chunkWordOffset,
      wordCount,
      lastCharIndex: 0,
      lastWordIndex: 0,
      holdForLookup: false,
      stopped: false,
    }
    await playListenSession(session, 0)
  }

  const listenWord = (word) => {
    if (!word) return
    speakFrench(word, { rate: 0.62, voiceURI }).catch(() => {})
  }

  const listenHypWord = (hyp) => {
    if (!hyp) return
    speakFrench(`Vous avez dit : ${hyp}`, { rate: 0.68, voiceURI }).catch(() => {})
  }

  const listenSpokenClip = async (hyp, hypIndex) => {
    if (!audioUrl || !hyp) {
      listenHypWord(hyp)
      return
    }
    const hypTokens = tokenizeFrench(transcript)
    const timing = findTimingForHyp(timedWords, hyp, hypIndex, hypTokens.length)
    if (timing) {
      try {
        await playAudioRange(audioUrl, timing.start, timing.end)
        return
      } catch {
        // fall through
      }
    }
    listenHypWord(hyp)
  }

  const lookup = async (text, { speak = true, kind = 'word' } = {}) => {
    let cleaned
    if (kind === 'sentence') {
      cleaned = String(text ?? '')
        .trim()
        .replace(/\s+/g, ' ')
    } else {
      cleaned = String(text ?? '')
        .trim()
        .replace(/[^\p{L}\p{N}'’-]+/gu, '')
    }
    if (!cleaned) return

    const session = listenSessionRef.current
    const shouldResume =
      Boolean(session) &&
      !session.stopped &&
      (session.mode === 'listen' || session.mode === 'listen-all')

    if (shouldResume) {
      session.holdForLookup = true
      guideStopRef.current?.()
      guideStopRef.current = null
    }

    if (speak) {
      await speakFrench(cleaned, {
        rate: kind === 'sentence' ? 0.7 : 0.62,
        voiceURI,
      }).catch(() => {})
    }

    setLookupWord(cleaned)
    setLookupBusy(true)
    setLookupError('')
    setLookupResult({
      source: cleaned,
      translated: '',
      alternatives: [],
      url: reversoContextUrl(cleaned),
      provider: 'loading',
      kind,
    })
    try {
      const result = await translateFrenchToEnglish(cleaned)
      setLookupResult({ ...result, kind })
      if (result.note) setLookupError(result.note)
      else setLookupError('')
    } catch (err) {
      setLookupError(err.message || 'Traduction impossible')
      setLookupResult({
        source: cleaned,
        translated: '',
        url: reversoContextUrl(cleaned),
        kind,
      })
    } finally {
      setLookupBusy(false)
    }

    if (
      shouldResume &&
      listenSessionRef.current === session &&
      !session.stopped
    ) {
      session.holdForLookup = false
      // Resume from the word that was playing when interrupted
      const resumeAt = charIndexAtWord(session.tokens, Math.max(0, session.lastWordIndex || 0))
      await new Promise((r) => window.setTimeout(r, 350))
      if (listenSessionRef.current === session && !session.stopped) {
        await playListenSession(session, resumeAt)
      }
    }
  }

  /** Passage taps: word or whole sentence when Clic is on */
  const onPassageWordClick = (token) => {
    if (!clickLearn) return
    if (clickTarget === 'phrase') {
      const index = token?.sentenceIndex ?? -1
      if (index < 0) return
      const line = sentenceTextFromTokens(fullDisplayTokens, index)
      if (!line) return
      setSelectedSentence(index)
      lookup(line, { speak: true, kind: 'sentence' })
      return
    }
    setSelectedSentence(-1)
    lookup(token?.lookup || token, { speak: true, kind: 'word' })
  }

  /** Drag-select any span in the passage → translate that selection */
  const onPassageMouseUp = () => {
    if (!clickLearn) return
    const selection = window.getSelection?.()
    if (!selection || selection.isCollapsed) return
    const raw = String(selection.toString() || '').trim().replace(/\s+/g, ' ')
    if (raw.length < 2) return
    const kind = /\s/.test(raw) || /[.!?…]/.test(raw) ? 'sentence' : 'word'
    if (kind === 'sentence') setSelectedSentence(-1)
    lookup(raw, { speak: true, kind })
  }

  const toggleClickLearn = () => {
    setClickLearn((value) => {
      const next = !value
      if (!next) {
        setLookupResult(null)
        setLookupWord('')
        setLookupError('')
        setSelectedSentence(-1)
      }
      return next
    })
  }

  const saveLookupToVocab = () => {
    if (!lookupResult?.source) return
    setVocab((prev) =>
      upsertVocabularyEntry(prev, {
        word: lookupResult.source,
        translation: lookupResult.translated || '(voir Reverso Context)',
      }),
    )
  }

  const wrongPairs = practiceErrors(alignment?.ops ?? [], {
    asrUnreliable: Boolean(alignment?.asrUnreliable),
  })

  return (
    <div className="app-shell mx-auto min-h-screen max-w-[90rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-ring uppercase">
          Lecture guidée · vocabulaire · prononciation
        </p>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Coach de lecture française</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Contrôles flottants à droite (ou en bas sur mobile) : Clic, Ombre, travaux, écoute et
          enregistrement.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span
            className={
              'inline-block h-2.5 w-2.5 rounded-full ' +
              (whisperReady === 'ready'
                ? 'bg-emerald-500'
                : whisperReady === 'checking'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-red-500')
            }
            title="État Whisper"
          />
          Whisper {whisperReady === 'ready' ? 'prêt' : whisperReady === 'checking' ? '…' : 'down'}
          <span className="text-muted-foreground">({whisperModel})</span>
        </span>
        <span className="text-muted-foreground">Modèle :</span>
        <Button
          size="sm"
          variant={whisperModel === 'base' ? 'default' : 'outline'}
          onClick={() => selectWhisperModel('base')}
        >
          Base
        </Button>
        <Button
          size="sm"
          variant={whisperModel === 'small' ? 'default' : 'outline'}
          onClick={() => selectWhisperModel('small')}
          title="Plus précis en français — nécessite le profil Docker small"
        >
          Small
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refreshWhisperStatus()}
          title="Revérifier Whisper"
          disabled={phase === 'recording' || phase === 'transcribing'}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <span className="text-border">|</span>
        <span className="inline-flex items-center gap-2">
          <span
            className={
              'inline-block h-2.5 w-2.5 rounded-full ' +
              (pronounceReady === 'ready'
                ? 'bg-emerald-500'
                : pronounceReady === 'checking'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-red-500')
            }
            title="État OpenPronounce (conseils phonétiques)"
          />
          Prononciation{' '}
          {pronounceReady === 'ready' ? 'prête' : pronounceReady === 'checking' ? '…' : 'down'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => resetPronounceStatus()}
          title="Effacer le dernier score et revérifier OpenPronounce"
          disabled={phase === 'recording' || phase === 'transcribing'}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        {whisperModel === 'small' && whisperReady === 'down' ? (
          <span className="text-xs text-wrong">
            Lancez : <code>docker compose --profile small up -d</code>
          </span>
        ) : null}
        {pronounceReady === 'down' ? (
          <span className="text-xs text-wrong">
            Lancez : <code>docker compose up -d --build pronounce</code> (1er démarrage long)
          </span>
        ) : null}
      </div>

      {clickLearn ? (
        <div className="sticky top-0 z-20 mb-6 rounded-xl border border-ring/25 bg-card/95 p-4 shadow-sm backdrop-blur">
          {lookupResult || lookupBusy ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {lookupResult?.kind === 'sentence' || clickTarget === 'phrase'
                    ? 'Phrase sélectionnée'
                    : 'Mot sélectionné'}
                </p>
                <p
                  className={
                    'mt-1 font-serif leading-snug ' +
                    (lookupResult?.kind === 'sentence' ? 'text-lg sm:text-xl' : 'text-2xl')
                  }
                >
                  <span className="text-foreground">{lookupResult?.source || lookupWord}</span>
                </p>
                <p className="mt-2 text-base sm:text-lg">
                  <span className="text-muted-foreground">→ </span>
                  <span className="text-ring">
                    {lookupBusy
                      ? '…'
                      : lookupResult?.translated || 'voir Reverso Context'}
                  </span>
                </p>
                {lookupResult?.alternatives?.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aussi : {lookupResult.alternatives.join(' · ')}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    speakFrench(lookupResult?.source || lookupWord, {
                      rate: lookupResult?.kind === 'sentence' ? 0.7 : 0.62,
                      voiceURI,
                    }).catch(() => {})
                  }
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  Réécouter
                </Button>
                <Button
                  size="sm"
                  onClick={saveLookupToVocab}
                  disabled={!lookupResult?.translated}
                >
                  Sauver
                </Button>
                <a
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
                  href={
                    lookupResult?.url ||
                    reversoContextUrl(lookupResult?.source || lookupWord)
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Reverso
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Mode {clickTarget === 'phrase' ? 'phrase' : 'mot'} — cliquez une ligne pour traduire
              toute la phrase, ou sélectionnez du texte avec la souris.
            </p>
          )}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={sourceMode === 'library' ? 'default' : 'outline'}
          onClick={() => {
            setSourceMode('library')
            setChunkIndex(0)
            resetAttempt()
          }}
        >
          Bibliothèque
        </Button>
        <Button
          variant={sourceMode === 'custom' ? 'default' : 'outline'}
          onClick={() => {
            setSourceMode('custom')
            setChunkIndex(0)
            resetAttempt()
          }}
        >
          <Plus className="h-4 w-4" />
          Mon texte
        </Button>
      </div>

      {sourceMode === 'library' ? (
        <>
          <label className="mb-2 block text-sm font-medium" htmlFor="passage">
            Passage
          </label>
          <select
            id="passage"
            className="mb-4 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            value={passageId}
            onChange={(event) => onPassageChange(event.target.value)}
          >
            {passages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.topic} — {item.title}
              </option>
            ))}
          </select>
        </>
      ) : (
        <div className="mb-4 space-y-2">
          <label className="block text-sm font-medium" htmlFor="custom">
            Votre texte (collé ou écrit)
          </label>
          <textarea
            id="custom"
            rows={5}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm leading-relaxed"
            placeholder="Collez un article, un dialogue, ou écrivez vos phrases…"
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={applyCustomText}>Utiliser ce texte</Button>
            <Button variant="outline" onClick={openWorksPanel}>
              <Database className="h-4 w-4" />
              Sauver dans Mes travaux
            </Button>
            <Button
              variant="outline"
              onClick={listenFullPassage}
              disabled={!fullText || phase === 'recording'}
            >
              <Volume2 className="h-4 w-4" />
              Écouter tout
            </Button>
          </div>
          {activeWorkTitle ? (
            <p className="text-xs text-muted-foreground">
              Travail ouvert : <span className="text-foreground font-medium">{activeWorkTitle}</span>
            </p>
          ) : null}
        </div>
      )}

      {showWorks ? (
        <WorksPanel
          currentText={
            sourceMode === 'custom'
              ? customDraft || customText
              : activePassage?.text || ''
          }
          currentVocab={vocab}
          activeWorkId={activeWorkId}
          onLoadWork={loadSavedWork}
          onSaved={onWorkSaved}
          onClose={() => setShowWorks(false)}
        />
      ) : null}

      {showDeck ? (
        <VocabDeck
          vocab={vocab}
          onUpdateVocab={setVocab}
          onSpeak={listenWord}
          onClose={() => setShowDeck(false)}
        />
      ) : null}

      {showVocab ? (
        <section className="mb-6 rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-xl">Vocabulaire</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowDeck(true)}>
                <Layers className="h-3.5 w-3.5" />
                Réviser
              </Button>
              <p className="text-xs text-muted-foreground self-center">
                Traduction FR→EN + Reverso Context
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Mot français…"
              value={lookupWord}
              onChange={(event) => setLookupWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') lookup(lookupWord)
              }}
            />
            <Button onClick={() => lookup(lookupWord)} disabled={lookupBusy}>
              <Languages className="h-4 w-4" />
              {lookupBusy ? '…' : 'Traduire'}
            </Button>
          </div>
          {lookupError ? (
            <p className="text-sm text-muted-foreground">{lookupError}</p>
          ) : null}
          {lookupResult ? (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
              <div>
                <p>
                  <span className="font-medium">{lookupResult.source}</span>
                  {lookupResult.translated ? (
                    <>
                      {' '}
                      → <span className="text-ring">{lookupResult.translated}</span>
                    </>
                  ) : null}
                </p>
                {lookupResult.alternatives?.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aussi : {lookupResult.alternatives.join(' · ')}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {lookupResult.provider === 'reverso'
                    ? 'Source : Reverso'
                    : 'Glose rapide — ouvrez Reverso pour le contexte et les exemples.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => listenWord(lookupResult.source)}>
                  <Volume2 className="h-3.5 w-3.5" />
                  FR
                </Button>
                <Button size="sm" onClick={saveLookupToVocab} disabled={!lookupResult.translated}>
                  Sauver
                </Button>
                <a
                  className="inline-flex h-8 items-center rounded-md border border-border bg-foreground px-3 text-xs text-background hover:opacity-90"
                  href={lookupResult.url || reversoContextUrl(lookupResult.source)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Exemples Reverso
                </a>
              </div>
            </div>
          ) : null}
          {vocab.length ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {vocab.slice(0, 40).map((entry) => (
                <li
                  key={entry.word}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => lookup(entry.word)}
                  >
                    <span className="font-medium">{entry.word}</span>
                    <span className="ml-2 text-muted-foreground">{entry.translation}</span>
                  </button>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => listenWord(entry.word)}>
                      <Volume2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setVocab((prev) => removeVocabularyEntry(prev, entry.word))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun mot sauvé. Cliquez un mot du passage après une lecture pour l’ajouter.
            </p>
          )}
        </section>
      ) : null}

      {chunks.length ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>
            {listeningAll ? (
              <>Texte entier · écoute ({paceConfig.label})</>
            ) : (
              <>
                Étape <span className="font-semibold text-foreground">{safeIndex + 1}</span> /{' '}
                {chunks.length} · {shadowMode ? 'ombre (1 phrase)' : 'deux phrases'} · texte
                complet affiché
              </>
            )}
          </p>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-ring transition-all"
              style={{
                width: listeningAll
                  ? `${fullWordCount > 0 && guideWordIndex >= 0 ? ((guideWordIndex + 1) / fullWordCount) * 100 : 0}%`
                  : `${((safeIndex + (phase === 'done' && wordPass ? 1 : 0)) / chunks.length) * 100}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {activePassage.topic}
          {activePassage.id === CUSTOM_PASSAGE_ID ? ' · texte perso' : ''}
          {listeningAll ? ' · écoute complète' : ' · texte entier'}
        </p>
        <h2 className="mb-4 font-serif text-2xl">{activePassage.title}</h2>
        {fullText ? (
          <div className="passage-text select-text" onMouseUp={onPassageMouseUp}>
            {(() => {
              let wordOrdinal = -1
              const stepStart = chunkWordOffset
              const stepEnd = chunkWordOffset + wordCount
              return fullDisplayTokens.map((token, index) => {
                if (token.type === 'break') {
                  return <br key={`br-${index}`} />
                }
                if (token.type !== 'word') {
                  const inSelected =
                    clickLearn &&
                    clickTarget === 'phrase' &&
                    selectedSentence >= 0 &&
                    token.sentenceIndex === selectedSentence
                  return (
                    <span
                      key={`t-${index}`}
                      className={inSelected ? 'bg-secondary/80' : undefined}
                    >
                      {token.value}
                    </span>
                  )
                }
                wordOrdinal += 1
                const inCurrentStep = wordOrdinal >= stepStart && wordOrdinal < stepEnd
                const active = guideWordIndex === wordOrdinal
                const passed =
                  guideWordIndex >= 0 &&
                  wordOrdinal < guideWordIndex &&
                  (listeningAll || (listeningStep && inCurrentStep))
                const outsideStep = !listeningAll && !inCurrentStep
                const inSelectedSentence =
                  clickLearn &&
                  clickTarget === 'phrase' &&
                  selectedSentence >= 0 &&
                  token.sentenceIndex === selectedSentence
                return (
                  <button
                    key={`full-w-${index}-${token.lookup}`}
                    type="button"
                    data-guide-word={wordOrdinal}
                    className={
                      'inline rounded-sm px-0.5 transition-colors ' +
                      (active
                        ? 'guide-word-active'
                        : passed
                          ? 'guide-word-passed'
                          : inSelectedSentence
                            ? 'bg-secondary ring-1 ring-ring/30'
                            : outsideStep
                              ? 'text-muted-foreground/55'
                              : clickLearn
                                ? 'hover:bg-secondary cursor-pointer'
                                : 'cursor-text')
                    }
                    onClick={() => onPassageWordClick(token)}
                    title={
                      clickLearn
                        ? clickTarget === 'phrase'
                          ? 'Traduire toute la phrase'
                          : 'Prononcer + traduire ce mot'
                        : 'Activez « Clic » pour entendre et traduire'
                    }
                  >
                    {token.value}
                  </button>
                )
              })
            })()}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ajoutez votre texte ou choisissez un passage de la bibliothèque.
          </p>
        )}
        {shadowMode && phase === 'idle' && !listeningAll ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Mode ombre : 1) <strong>Écouter (guidé)</strong> 2) <strong>Enregistrer</strong> la même
            phrase 3) lire le retour.
            {!shadowHeard ? ' Commencez par écouter le modèle.' : ' Vous pouvez enregistrer.'}
          </p>
        ) : null}
        {phase === 'recording' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Parlez à votre rythme — le retour arrive après Stop. (Étape en surbrillance dans le
            texte.)
          </p>
        ) : null}
        {guideMode === 'listen' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Écoute guidée ({paceConfig.label}). Un clic explique, puis la lecture reprend où elle
            s’était arrêtée.
          </p>
        ) : null}
        {guideMode === 'listen-all' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Texte entier ({paceConfig.label}). Cliquez un mot/phrase pour l’expliquer — la lecture
            reprend ensuite.
          </p>
        ) : null}
      </section>

      <aside className="practice-dock" aria-label="Contrôles flottants">
        <div className="practice-dock__actions">
          <p className="practice-dock__label">Outils</p>
          <Button
            variant={clickLearn ? 'default' : 'outline'}
            onClick={toggleClickLearn}
            title="Activer : clic ou sélection pour entendre + traduire"
          >
            <Languages className="h-4 w-4" />
            Clic {clickLearn ? 'ON' : 'OFF'}
          </Button>
          {clickLearn ? (
            <div className="practice-dock__pace">
              <Button
                size="sm"
                variant={clickTarget === 'word' ? 'default' : 'outline'}
                onClick={() => {
                  setClickTarget('word')
                  setSelectedSentence(-1)
                }}
                title="Clic = un mot"
              >
                Mot
              </Button>
              <Button
                size="sm"
                variant={clickTarget === 'phrase' ? 'default' : 'outline'}
                onClick={() => setClickTarget('phrase')}
                title="Clic = toute la phrase (meilleure traduction)"
              >
                Phrase
              </Button>
            </div>
          ) : null}
          <Button
            variant={shadowMode ? 'default' : 'outline'}
            onClick={toggleShadowMode}
            title="Une phrase : écouter le modèle, puis répéter"
          >
            Ombre {shadowMode ? 'ON' : 'OFF'}
          </Button>
          <Button
            variant={showWorks ? 'default' : 'outline'}
            onClick={openWorksPanel}
            title="Base locale : sauver / renommer / rouvrir vos textes"
          >
            <Database className="h-4 w-4" />
            Mes travaux
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowDeck(true)
              setShowVocab(false)
              setShowWorks(false)
            }}
          >
            <Layers className="h-4 w-4" />
            Révision
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowVocab((v) => !v)
              setShowDeck(false)
              setShowWorks(false)
            }}
          >
            <BookOpen className="h-4 w-4" />
            Vocabulaire ({vocab.length})
          </Button>
          <Button variant="outline" onClick={runFixture}>
            <Sparkles className="h-4 w-4" />
            Démo
          </Button>
        </div>

        <div className="practice-dock__divider" />

        <div className="practice-dock__actions">
          <p className="practice-dock__label">Voix française</p>
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-xs"
            value={voiceURI}
            onChange={(event) => setVoiceURI(event.target.value)}
            disabled={phase === 'recording'}
            title="Choisir un locuteur français (accent natif)"
          >
            {!frenchVoices.length ? (
              <option value="">Aucune voix FR — installez-en une</option>
            ) : (
              frenchVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.accent}
                  {v.natural ? ' · naturel' : ''}
                </option>
              ))
            )}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={phase === 'recording'}
            onClick={() => {
              setError('')
              speakFrench('Bonjour, je suis votre coach de lecture française.', {
                rate: paceConfig.ttsRate,
                voiceURI,
              }).catch((err) => {
                setError(
                  err?.message ||
                    'Impossible de parler. Installez une voix française (Amélie / Thomas).',
                )
              })
            }}
          >
            <Volume2 className="h-3.5 w-3.5" />
            Tester la voix
          </Button>
          {!frenchVoices.length ? (
            <p className="text-[0.65rem] leading-snug text-wrong">
              Aucune voix FR détectée. Mac : Réglages → Accessibilité → Contenu lu à voix haute →
              téléchargez Amélie ou Thomas (Enhanced). Opera : préférez une voix « local » / Enhanced.
            </p>
          ) : (
            <p className="text-[0.65rem] leading-snug text-muted-foreground">
              Prefer Amélie/Thomas Enhanced (local). Safari et Opera peuvent lister des voix
              différentes — recliquez Tester la voix après un changement.
            </p>
          )}
        </div>

        <div>
          <p className="practice-dock__label">Vitesse d’écoute</p>
          <div className="practice-dock__pace">
            {Object.entries(PACE_PRESETS)
              .filter(([key]) => key !== 'libre')
              .map(([key, preset]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={pace === key ? 'default' : 'outline'}
                  onClick={() => setPace(key)}
                  disabled={phase === 'recording' || phase === 'transcribing'}
                  title={`Modèle ~${preset.wpm} mots/min`}
                >
                  {preset.label}
                </Button>
              ))}
          </div>
          <p className="mt-1.5 text-[0.65rem] leading-snug text-muted-foreground">
            Enregistrement libre. Vitesse = écoute seulement.
          </p>
        </div>

        <div className="practice-dock__actions">
          <p className="practice-dock__label">Pratique</p>
          {phase === 'recording' ? (
            <Button variant="destructive" onClick={stopRecording}>
              <CircleStop className="h-4 w-4" />
              Stop ({seconds}s)
            </Button>
          ) : (
            <Button onClick={startRecording} disabled={phase === 'transcribing' || !currentChunk}>
              <Mic className="h-4 w-4" />
              Enregistrer
            </Button>
          )}
          <Button variant="secondary" onClick={resetAttempt} disabled={phase === 'recording'}>
            <RotateCcw className="h-4 w-4" />
            Réessayer
          </Button>
          <Button
            variant="outline"
            onClick={listenFullPassage}
            disabled={!activePassage?.text?.trim() || phase === 'recording'}
            title="Lire tout le passage d’un coup"
          >
            <Volume2 className="h-4 w-4" />
            Écouter tout
          </Button>
          <Button
            variant="outline"
            onClick={listenChunk}
            disabled={!currentChunk || phase === 'recording'}
            title="Lire seulement l’étape actuelle avec surlignage"
          >
            <Volume2 className="h-4 w-4" />
            Écouter (guidé)
          </Button>
          {guideMode === 'listen' || guideMode === 'listen-all' ? (
            <Button variant="ghost" onClick={stopGuide}>
              Stop écoute
            </Button>
          ) : null}
          {audioUrl ? (
            <Button variant="outline" onClick={() => document.getElementById('replay')?.play()}>
              <Volume2 className="h-4 w-4" />
              Ma prise
            </Button>
          ) : null}
          {canAdvance ? (
            <Button onClick={goNextChunk}>
              Continuer
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {phase === 'recording' ? (
          <p className="text-xs text-wrong">Enregistrement…</p>
        ) : null}
        {phase === 'transcribing' ? (
          <p className="text-xs text-muted-foreground">Analyse…</p>
        ) : null}
      </aside>

      {audioUrl ? <audio id="replay" className="mt-4 w-full" controls src={audioUrl} /> : null}

      {phase === 'idle' && !error ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          {shadowMode
            ? 'Ombre : écoutez une phrase, répétez-la, puis avancez. Utilisez Révision pour le vocabulaire sauvé.'
            : 'Enregistrez à votre rythme, puis lisez la revue. Optionnel : Ombre, Clic mot, Révision.'}
        </p>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-wrong">
          <p>{error}</p>
        </div>
      ) : null}

      {transcript ? (
        <section className="mt-8 space-y-4">
          {focusReview ? (
            <div className="rounded-xl border border-ring/30 bg-secondary/40 p-4 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-serif text-xl">Revue de l’étape — à focaliser</h3>
                {alignment ? (
                  <p className="text-lg font-semibold text-ring">{scoreLabel(alignment.score)}</p>
                ) : null}
              </div>
              <p className="text-sm">{focusReview.summary}</p>
              <ul className="space-y-2">
                {focusReview.focuses.map((item) => (
                  <li key={item.id} className="rounded-md bg-card px-3 py-2 text-sm">
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-muted-foreground">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Transcription
            </p>
            <p className="text-sm leading-relaxed">{transcript}</p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              Mots — vert = OK · ambre = presque (accent/genre/ASR) · rouge = à retravailler
            </p>
            <FeedbackChips ops={alignment?.ops ?? []} onWordClick={lookup} />
          </div>

          {alignment?.asrUnreliable ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">Whisper a peut‑être mal entendu ce tour</p>
              <p className="mt-1 text-muted-foreground">
                Beaucoup d’écarts viennent souvent de la reconnaissance, pas de votre lecture
                (décalage mot à mot). Réessayez un peu plus lentement et près du micro — ou
                écoutez d’abord le modèle.
              </p>
            </div>
          ) : null}

          {wrongPairs.length ? (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="font-serif text-xl">À retravailler — écouter</h3>
              <p className="text-xs text-muted-foreground">
                Uniquement les écarts nets (pas les petites variantes FR / ASR).
              </p>
              <ul className="space-y-2">
                {wrongPairs.map((op, index) => (
                  <li
                    key={`${op.target}-${op.hyp}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{op.target}</span>
                      <span className="text-muted-foreground"> → vous : </span>
                      <span className="text-wrong">{op.hyp}</span>
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => listenWord(op.target)}>
                        Modèle
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => listenSpokenClip(op.hyp, index)}
                      >
                        Ce que j’ai dit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => lookup(op.target)}>
                        <Languages className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-serif text-xl">Prononciation (phonèmes)</h3>
              {pronounceTips?.score != null ? (
                <p className="text-2xl font-semibold text-ring">
                  {Math.round(pronounceTips.score)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/ 100</span>
                </p>
              ) : null}
            </div>
            {pronounceNote ? <p className="text-sm text-muted-foreground">{pronounceNote}</p> : null}
            {pronounceTips?.errors?.length ? (
              <ul className="space-y-2">
                {pronounceTips.errors.map((err, index) => (
                  <li
                    key={`${err.word}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{err.word}</span>
                      <span className="ml-2 text-muted-foreground">
                        /{err.expected}/ → /{err.actual || '—'}/
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => listenWord(err.word)}>
                        <Volume2 className="h-3.5 w-3.5" />
                        Modèle
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => lookup(err.word)}>
                        <Languages className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : !pronounceNote ? (
              <p className="text-sm text-muted-foreground">Aucun écart phonétique signalé.</p>
            ) : null}
          </div>

          {phase === 'done' && isLastChunk ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-match">
              Passage terminé. Ouvrez le vocabulaire pour revoir les mots sauvés, ou chargez un nouveau
              texte.
            </p>
          ) : null}
        </section>
      ) : null}

      <footer className="mt-10 border-t border-border pt-4 text-sm text-muted-foreground">
        <p>
          Créé par{' '}
          <a
            className="text-ring underline-offset-2 hover:underline"
            href="https://saketsuman.com"
            target="_blank"
            rel="noreferrer"
          >
            Saket Suman
          </a>
          {' · '}
          Besoin d’aide ?{' '}
          <a
            className="text-ring underline-offset-2 hover:underline"
            href="https://saketsuman.com/contact/"
            target="_blank"
            rel="noreferrer"
          >
            Contact
          </a>
        </p>
      </footer>
    </div>
  )
}
