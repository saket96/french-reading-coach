import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  CircleStop,
  Languages,
  Mic,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import { Button } from './components/ui/button.jsx'
import { FIXTURE_CHUNK_INDEX, FIXTURE_PASSAGE_ID, FIXTURE_TRANSCRIPT } from './fixtures.js'
import { alignWords } from './lib/align.js'
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
import { speakFrench, stopSpeaking } from './lib/speak.js'
import { tokenizeFrench } from './lib/tokenize.js'
import { googleTranslateUrl, translateFrenchToEnglish } from './lib/translate.js'
import {
  loadVocabulary,
  removeVocabularyEntry,
  saveVocabulary,
  upsertVocabularyEntry,
} from './lib/vocabulary.js'
import { transcribeFrenchAudio, WhisperUnavailableError } from './lib/whisper.js'
import { passages } from './passages.js'

const PASS_THRESHOLD = 0.7

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

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  const activePassage = useMemo(() => {
    if (sourceMode === 'custom') return customPassage(customText)
    return passages.find((item) => item.id === passageId) ?? passages[0]
  }, [sourceMode, customText, passageId])

  const chunks = useMemo(() => {
    if (!activePassage.text?.trim()) return []
    return passageChunks(activePassage.text, 2)
  }, [activePassage.text])

  const safeIndex = Math.min(chunkIndex, Math.max(chunks.length - 1, 0))
  const currentChunk = chunks[safeIndex] ?? ''
  const isLastChunk = chunks.length === 0 || safeIndex >= chunks.length - 1

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
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioUrl) URL.revokeObjectURL(audioUrl)
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
    stopSpeaking()
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
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        clearAttemptAudio()
        setAudioUrl(URL.createObjectURL(blob))
        setPhase('transcribing')
        try {
          const result = await transcribeFrenchAudio(blob)
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

  const listenChunk = () => {
    if (!currentChunk) return
    speakFrench(currentChunk).catch(() => {
      setError('Impossible de lire le texte à voix haute. Vérifiez les voix système fr-FR.')
    })
  }

  const listenWord = (word) => {
    if (!word) return
    speakFrench(word, { rate: 0.85 }).catch(() => {})
  }

  const listenHypWord = (hyp) => {
    if (!hyp) return
    speakFrench(`Vous avez dit : ${hyp}`, { rate: 0.9 }).catch(() => {})
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

  const lookup = async (word) => {
    const cleaned = String(word ?? '')
      .trim()
      .replace(/[^\p{L}\p{N}'’-]+/gu, '')
    if (!cleaned) return
    setLookupWord(cleaned)
    setLookupBusy(true)
    setLookupError('')
    setLookupResult(null)
    setShowVocab(true)
    try {
      const result = await translateFrenchToEnglish(cleaned)
      setLookupResult(result)
    } catch (err) {
      setLookupError(err.message || 'Traduction impossible')
      setLookupResult({ source: cleaned, translated: '', url: googleTranslateUrl(cleaned) })
    } finally {
      setLookupBusy(false)
    }
  }

  const saveLookupToVocab = () => {
    if (!lookupResult?.source) return
    setVocab((prev) =>
      upsertVocabularyEntry(prev, {
        word: lookupResult.source,
        translation: lookupResult.translated || '(voir Google Translate)',
      }),
    )
  }

  const wrongPairs = (alignment?.ops ?? [])
    .map((op, index) => ({ ...op, index }))
    .filter((op) => op.type === 'wrong' && op.hyp)

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-ring uppercase">
            Lecture · vocabulaire · prononciation
          </p>
          <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Coach de lecture française</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Deux phrases à la fois, revue ciblée (liaisons, terminaisons), écoute de vos erreurs, et
            vocabulaire avec Google Translate.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Button variant="outline" onClick={() => setShowVocab((v) => !v)}>
            <BookOpen className="h-4 w-4" />
            Vocabulaire ({vocab.length})
          </Button>
          <Button variant="outline" onClick={runFixture}>
            <Sparkles className="h-4 w-4" />
            Démo
          </Button>
        </div>
      </header>

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

      {showVocab ? (
        <section className="mb-6 rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-xl">Vocabulaire</h2>
            <p className="text-xs text-muted-foreground">
              Cliquez un mot du texte ou du retour pour traduire (Google Translate).
            </p>
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
          {lookupError ? <p className="text-sm text-wrong">{lookupError}</p> : null}
          {lookupResult ? (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
              <p>
                <span className="font-medium">{lookupResult.source}</span>
                {lookupResult.translated ? (
                  <>
                    {' '}
                    → <span className="text-ring">{lookupResult.translated}</span>
                  </>
                ) : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => listenWord(lookupResult.source)}>
                  <Volume2 className="h-3.5 w-3.5" />
                  FR
                </Button>
                <Button size="sm" onClick={saveLookupToVocab}>
                  Sauver
                </Button>
                <a
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
                  href={lookupResult.url || googleTranslateUrl(lookupResult.source)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ouvrir Google Translate
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
            {chunks.length} · deux phrases
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
            {tokenizeFrench(currentChunk).map((word, index) => (
              <button
                key={`${word}-${index}`}
                type="button"
                className="mr-1.5 inline rounded-sm hover:bg-secondary px-0.5"
                onClick={() => lookup(word)}
                title="Traduire / sauver"
              >
                {word}
              </button>
            ))}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ajoutez votre texte ou choisissez un passage de la bibliothèque.
          </p>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
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
        <Button variant="outline" onClick={listenChunk} disabled={!currentChunk || phase === 'recording'}>
          <Volume2 className="h-4 w-4" />
          Écouter le modèle
        </Button>
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
          Lisez les deux phrases, écoutez le modèle, enregistrez, puis lisez la revue (mots, liaisons,
          terminaisons). Cliquez un mot pour Google Translate et votre carnet de vocabulaire.
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
              Mots — cliquez pour traduire · vert = OK · rouge = écart
            </p>
            <FeedbackChips ops={alignment?.ops ?? []} onWordClick={lookup} />
          </div>

          {wrongPairs.length ? (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h3 className="font-serif text-xl">Vos erreurs — écouter</h3>
              <ul className="space-y-2">
                {wrongPairs.map((op) => (
                  <li
                    key={`${op.target}-${op.index}`}
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
                      <Button size="sm" variant="outline" onClick={() => listenSpokenClip(op.hyp, op.index)}>
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
