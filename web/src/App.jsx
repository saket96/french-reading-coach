import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  CircleStop,
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
import { FIXTURE_CHUNK_INDEX, FIXTURE_PASSAGE_ID, FIXTURE_TRANSCRIPT } from './fixtures.js'
import { alignWords, practiceErrors } from './lib/align.js'
import { findTimingForHyp, playAudioRange } from './lib/audioClip.js'
import { passageChunks } from './lib/chunks.js'
import { CUSTOM_PASSAGE_ID, customPassage, loadCustomText, saveCustomText } from './lib/customText.js'
import { analyzeLiaisons, analyzeTerminations } from './lib/liaison.js'
import {
  assessFrenchPronunciation,
  extractPronunciationTips,
  PronounceUnavailableError,
} from './lib/pronounce.js'
import { buildFocusReview } from './lib/review.js'
import { countGuidedWords } from './lib/guided.js'
import {
  PACE_PRESETS,
  speakFrench,
  startReadingGuide,
  stopSpeaking,
  wordIndexFromCharIndex,
} from './lib/speak.js'
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
const PACE_KEY = 'frc-speaking-pace'
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

const pickMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) ?? ''
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
  const [guideWordIndex, setGuideWordIndex] = useState(-1)
  const [guideMode, setGuideMode] = useState('') // 'listen' | 'listen-all' | 'read' | ''
  const [clickLearn, setClickLearn] = useState(() => loadClickLearn())
  const [pace, setPace] = useState(() => loadPace())
  const [whisperModel, setWhisperModel] = useState(() => loadModel())
  const [whisperReady, setWhisperReady] = useState('checking') // checking | ready | down
  const [shadowMode, setShadowMode] = useState(() => loadShadow())
  const [shadowHeard, setShadowHeard] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const guideStopRef = useRef(null)

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
      localStorage.setItem(PACE_KEY, pace)
    } catch {
      // ignore
    }
  }, [pace])

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

  const stopGuide = () => {
    guideStopRef.current?.()
    guideStopRef.current = null
    setGuideWordIndex(-1)
    setGuideMode('')
    stopSpeaking()
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stopTimer()
        stopGuide()
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        clearAttemptAudio()
        setAudioUrl(URL.createObjectURL(blob))
        setPhase('transcribing')
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
                : 'Évaluation phonétique indisponible pour ce tour.',
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
      }
      recorder.start()
      startTimer()
      setPhase('recording')
      // Record at your own pace — feedback comes after Stop
      stopGuide()
    } catch {
      setError(
        'Micro refusé ou indisponible. Autorisez le micro dans Chrome ou Edge, ou utilisez la démo sans micro.',
      )
      setPhase('idle')
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === 'recording') recorder.stop()
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

  /** Speak the full passage (all steps) at the selected listen pace. */
  const listenFullPassage = async () => {
    const text = activePassage?.text?.trim()
    if (!text) return
    stopGuide()
    setError('')
    setGuideMode('listen-all')
    setGuideWordIndex(-1)
    try {
      await speakFrench(text, { rate: listenRateForPace() })
      setGuideMode('')
    } catch {
      setGuideMode('')
      setError(
        'La voix système n’a pas démarré. Sur Mac : Réglages système → Accessibilité → Contenu lu à voix haute → téléchargez une voix française.',
      )
    }
  }

  const listenChunk = async () => {
    if (!currentChunk) return
    stopGuide()
    setError('')
    setGuideMode('listen')
    setShadowHeard(true)
    const tokens = displayTokens
    const text = currentChunk
    let gotBoundary = false

    // If the browser never fires word boundaries, fall back to timed highlight
    const fallbackTimer = window.setTimeout(() => {
      if (gotBoundary || guideStopRef.current) return
      guideStopRef.current = startReadingGuide(wordCount, {
        wpm: listenWpmForPace(),
        onWord: (index) => setGuideWordIndex(index),
        onDone: () => {
          setGuideWordIndex(-1)
          setGuideMode('')
          guideStopRef.current = null
        },
      })
    }, 900)

    const listenWpm = listenWpmForPace()
    const listenRate = listenRateForPace()

    try {
      await speakFrench(text, {
        rate: listenRate,
        onBoundary: (charIndex) => {
          gotBoundary = true
          window.clearTimeout(fallbackTimer)
          // Prefer TTS sync over the timed guide
          guideStopRef.current?.()
          guideStopRef.current = null
          const idx = wordIndexFromCharIndex(text, tokens, charIndex)
          if (idx >= 0) setGuideWordIndex(idx)
        },
      })
      window.clearTimeout(fallbackTimer)
      if (!guideStopRef.current) {
        setGuideWordIndex(-1)
        setGuideMode('')
      }
    } catch {
      window.clearTimeout(fallbackTimer)
      if (!guideStopRef.current) {
        guideStopRef.current = startReadingGuide(wordCount, {
          wpm: listenWpm,
          onWord: (index) => setGuideWordIndex(index),
          onDone: () => {
            setGuideWordIndex(-1)
            setGuideMode('')
            guideStopRef.current = null
          },
        })
      }
      setError(
        'La voix système n’a pas démarré. Sur Mac : Réglages système → Accessibilité → Contenu lu à voix haute → téléchargez une voix française. Le surlignage guidé continue sans audio.',
      )
    }
  }

  const listenWord = (word) => {
    if (!word) return
    speakFrench(word, { rate: 0.62 }).catch(() => {})
  }

  const listenHypWord = (hyp) => {
    if (!hyp) return
    speakFrench(`Vous avez dit : ${hyp}`, { rate: 0.68 }).catch(() => {})
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

  const lookup = async (word, { speak = true } = {}) => {
    const cleaned = String(word ?? '')
      .trim()
      .replace(/[^\p{L}\p{N}'’-]+/gu, '')
    if (!cleaned) return

    if (speak) speakFrench(cleaned, { rate: 0.62 }).catch(() => {})

    setLookupWord(cleaned)
    setLookupBusy(true)
    setLookupError('')
    setLookupResult({
      source: cleaned,
      translated: '',
      alternatives: [],
      url: reversoContextUrl(cleaned),
      provider: 'loading',
    })
    try {
      const result = await translateFrenchToEnglish(cleaned)
      setLookupResult(result)
      if (result.note) setLookupError(result.note)
      else setLookupError('')
    } catch (err) {
      setLookupError(err.message || 'Traduction impossible')
      setLookupResult({ source: cleaned, translated: '', url: reversoContextUrl(cleaned) })
    } finally {
      setLookupBusy(false)
    }
  }

  /** Passage taps: only when "Clic mot" mode is on */
  const onPassageWordClick = (word) => {
    if (!clickLearn) return
    lookup(word, { speak: true })
  }

  const toggleClickLearn = () => {
    setClickLearn((value) => {
      const next = !value
      if (!next) {
        setLookupResult(null)
        setLookupWord('')
        setLookupError('')
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
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-ring uppercase">
            Lecture guidée · vocabulaire · prononciation
          </p>
          <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Coach de lecture française</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Enregistrez à votre rythme, ou activez l’ombre (une phrase). Voyant Whisper + modèle
            Base/Small en haut.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Button
            variant={clickLearn ? 'default' : 'outline'}
            onClick={toggleClickLearn}
            title="Activer ou désactiver : clic = prononcer + traduire"
          >
            <Languages className="h-4 w-4" />
            Clic mot {clickLearn ? 'ON' : 'OFF'}
          </Button>
          <Button
            variant={shadowMode ? 'default' : 'outline'}
            onClick={toggleShadowMode}
            title="Une phrase : écouter le modèle, puis répéter"
          >
            Ombre {shadowMode ? 'ON' : 'OFF'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowDeck(true)
              setShowVocab(false)
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
        {whisperModel === 'small' && whisperReady === 'down' ? (
          <span className="text-xs text-wrong">
            Lancez : <code>docker compose --profile small up -d</code>
          </span>
        ) : null}
      </div>

      {clickLearn ? (
        <div className="sticky top-0 z-20 mb-6 rounded-xl border border-ring/25 bg-card/95 p-4 shadow-sm backdrop-blur">
          {lookupResult || lookupBusy ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Mot sélectionné
                </p>
                <p className="mt-1 font-serif text-2xl leading-tight">
                  <span className="text-foreground">{lookupResult?.source || lookupWord}</span>
                  <span className="mx-2 text-muted-foreground">→</span>
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
                  onClick={() => listenWord(lookupResult?.source || lookupWord)}
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
              Mode actif — cliquez un mot du texte pour l’entendre et voir la traduction ici.
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
            <Button variant="outline" onClick={listenChunk} disabled={!currentChunk}>
              <Volume2 className="h-4 w-4" />
              Écouter
            </Button>
          </div>
        </div>
      )}

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
          Étape <span className="font-semibold text-foreground">{safeIndex + 1}</span> /{' '}
          {chunks.length} · {shadowMode ? 'ombre (1 phrase)' : 'deux phrases'}
        </p>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-ring transition-all"
              style={{
                width: `${((safeIndex + (phase === 'done' && wordPass ? 1 : 0)) / chunks.length) * 100}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {activePassage.topic}
          {activePassage.id === CUSTOM_PASSAGE_ID ? ' · texte perso' : ''}
        </p>
        <h2 className="mb-4 font-serif text-2xl">{activePassage.title}</h2>
        {currentChunk ? (
          <p className="passage-text">
            {(() => {
              let wordOrdinal = -1
              return displayTokens.map((token, index) => {
                if (token.type !== 'word') {
                  return <span key={`t-${index}`}>{token.value}</span>
                }
                wordOrdinal += 1
                const active = guideWordIndex === wordOrdinal
                const passed = guideWordIndex > wordOrdinal && guideWordIndex >= 0
                return (
                  <button
                    key={`w-${index}-${token.lookup}`}
                    type="button"
                    className={
                      'inline rounded-sm px-0.5 transition-colors ' +
                      (active
                        ? 'guide-word-active'
                        : passed
                          ? 'guide-word-passed'
                          : clickLearn
                            ? 'hover:bg-secondary cursor-pointer'
                            : 'cursor-text')
                    }
                    onClick={() => onPassageWordClick(token.lookup)}
                    title={
                      clickLearn
                        ? 'Prononcer + traduire'
                        : 'Activez « Clic mot » pour entendre et traduire'
                    }
                  >
                    {token.value}
                  </button>
                )
              })
            })()}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ajoutez votre texte ou choisissez un passage de la bibliothèque.
          </p>
        )}
        {shadowMode && phase === 'idle' ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Mode ombre : 1) <strong>Écouter (guidé)</strong> 2) <strong>Enregistrer</strong> la même
            phrase 3) lire le retour.
            {!shadowHeard ? ' Commencez par écouter le modèle.' : ' Vous pouvez enregistrer.'}
          </p>
        ) : null}
        {phase === 'recording' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Parlez à votre rythme — le retour arrive après Stop.
          </p>
        ) : null}
        {guideMode === 'listen' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Écoute guidée ({paceConfig.label}) — suivez le mot surligné.
          </p>
        ) : null}
        {guideMode === 'listen-all' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Lecture du texte entier ({paceConfig.label})…
          </p>
        ) : null}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Vitesse d’écoute :</span>
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
      <p className="mt-2 text-xs text-muted-foreground">
        L’enregistrement est libre (votre vitesse). Ces réglages concernent « Écouter tout » et
        « Écouter (guidé) ».
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {phase === 'recording' ? (
          <Button variant="destructive" size="lg" onClick={stopRecording}>
            <CircleStop className="h-4 w-4" />
            Stop ({seconds}s)
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={startRecording}
            disabled={phase === 'transcribing' || !currentChunk}
          >
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
            Réécouter ma prise
          </Button>
        ) : null}
        {canAdvance ? (
          <Button size="lg" onClick={goNextChunk}>
            Continuer
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <span className="text-sm text-wrong">Enregistrement…</span>
        ) : null}
        {phase === 'transcribing' ? (
          <span className="text-sm text-muted-foreground">Analyse…</span>
        ) : null}
      </div>

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
    </div>
  )
}
