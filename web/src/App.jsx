import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  CircleStop,
  Mic,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { Button } from './components/ui/button.jsx'
import { FIXTURE_CHUNK_INDEX, FIXTURE_PASSAGE_ID, FIXTURE_TRANSCRIPT } from './fixtures.js'
import { alignWords } from './lib/align.js'
import { passageChunks } from './lib/chunks.js'
import {
  assessFrenchPronunciation,
  extractPronunciationTips,
  PronounceUnavailableError,
} from './lib/pronounce.js'
import { speakFrench, stopSpeaking } from './lib/speak.js'
import { tokenizeFrench } from './lib/tokenize.js'
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

function FeedbackChips({ ops }) {
  if (!ops.length) {
    return <p className="text-sm text-muted-foreground">Aucun mot à comparer pour l’instant.</p>
  }

  return (
    <p className="flex flex-wrap gap-1.5">
      {ops.map((op, index) => {
        if (op.type === 'match') {
          return (
            <span
              key={`${op.type}-${index}`}
              className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-sm text-match"
            >
              {op.target}
            </span>
          )
        }
        if (op.type === 'wrong') {
          return (
            <span
              key={`${op.type}-${index}`}
              className="rounded-md bg-red-100 px-1.5 py-0.5 text-sm text-wrong"
              title={`entendu : ${op.hyp}`}
            >
              {op.target}
            </span>
          )
        }
        if (op.type === 'missing') {
          return (
            <span
              key={`${op.type}-${index}`}
              className="rounded-md bg-red-100 px-1.5 py-0.5 text-sm text-wrong line-through"
            >
              {op.target}
            </span>
          )
        }
        return (
          <span
            key={`${op.type}-${index}`}
            className="rounded-md bg-zinc-200 px-1.5 py-0.5 text-sm text-extra"
          >
            +{op.hyp}
          </span>
        )
      })}
    </p>
  )
}

export default function App() {
  const [passageId, setPassageId] = useState(passages[0].id)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [pronounceTips, setPronounceTips] = useState(null)
  const [pronounceNote, setPronounceNote] = useState('')

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  const passage = passages.find((item) => item.id === passageId) ?? passages[0]
  const chunks = useMemo(() => passageChunks(passage.text, 2), [passage.text])
  const safeIndex = Math.min(chunkIndex, Math.max(chunks.length - 1, 0))
  const currentChunk = chunks[safeIndex] ?? ''
  const isLastChunk = safeIndex >= chunks.length - 1

  const alignment = useMemo(() => {
    if (!transcript) return null
    return alignWords(tokenizeFrench(currentChunk), tokenizeFrench(transcript))
  }, [currentChunk, transcript])

  const wordPass = (alignment?.score ?? 0) >= PASS_THRESHOLD
  const canAdvance = phase === 'done' && (wordPass || Boolean(transcript))

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
    setSeconds(0)
    setPronounceTips(null)
    setPronounceNote('')
    clearAttemptAudio()
    stopSpeaking()
  }

  const onPassageChange = (nextId) => {
    setPassageId(nextId)
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
    setPronounceTips(null)
    setPronounceNote('')
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
          const text = await transcribeFrenchAudio(blob)
          if (!text) {
            setError('Whisper n’a renvoyé aucun texte. Réessayez en parlant plus près du micro.')
            setPhase('error')
            return
          }
          setTranscript(text)
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
    if (recorder && recorder.state === 'recording') {
      recorder.stop()
    }
  }

  const runFixture = () => {
    setError('')
    setPassageId(FIXTURE_PASSAGE_ID)
    setChunkIndex(FIXTURE_CHUNK_INDEX)
    setTranscript(FIXTURE_TRANSCRIPT)
    setPronounceTips({
      score: 68,
      errors: [
        {
          word: 'privilège',
          expected: 'pʁivilɛʒ',
          actual: 'pʁivilɛdʒ',
          confidence: 0.82,
        },
        {
          word: 'domicile',
          expected: 'dɔmisil',
          actual: 'mɛzɔ̃',
          confidence: 0.7,
        },
      ],
      transcript: FIXTURE_TRANSCRIPT,
    })
    setPronounceNote('')
    setPhase('done')
  }

  const listenChunk = () => {
    speakFrench(currentChunk).catch(() => {
      setError('Impossible de lire le texte à voix haute. Vérifiez les voix système fr-FR.')
    })
  }

  const listenWord = (word) => {
    speakFrench(word, { rate: 0.85 }).catch(() => {})
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-ring uppercase">
            Lecture à voix haute
          </p>
          <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Coach de lecture française</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Lisez deux phrases, corrigez-les, puis avancez. Whisper vérifie les mots ; OpenPronounce
            (local) signale la prononciation. Rien ne quitte votre machine.
          </p>
        </div>
        <Button variant="outline" onClick={runFixture} className="self-start">
          <Sparkles className="h-4 w-4" />
          Démo sans micro
        </Button>
      </header>

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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          Étape <span className="font-semibold text-foreground">{safeIndex + 1}</span> /{' '}
          {chunks.length} · deux phrases à la fois
        </p>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-ring transition-all"
            style={{ width: `${((safeIndex + (phase === 'done' && wordPass ? 1 : 0)) / chunks.length) * 100}%` }}
          />
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{passage.topic}</p>
        <h2 className="mb-4 font-serif text-2xl">{passage.title}</h2>
        <p className="passage-text">{currentChunk}</p>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {phase === 'recording' ? (
          <Button variant="destructive" size="lg" onClick={stopRecording}>
            <CircleStop className="h-4 w-4" />
            Stop ({seconds}s)
          </Button>
        ) : (
          <Button size="lg" onClick={startRecording} disabled={phase === 'transcribing'}>
            <Mic className="h-4 w-4" />
            Enregistrer ces 2 phrases
          </Button>
        )}
        <Button variant="secondary" onClick={resetAttempt} disabled={phase === 'recording'}>
          <RotateCcw className="h-4 w-4" />
          Réessayer
        </Button>
        <Button variant="outline" onClick={listenChunk} disabled={phase === 'recording'}>
          <Volume2 className="h-4 w-4" />
          Écouter le modèle
        </Button>
        {audioUrl ? (
          <Button variant="outline" onClick={() => document.getElementById('replay')?.play()}>
            <Volume2 className="h-4 w-4" />
            Réécouter
          </Button>
        ) : null}
        {phase === 'done' && !isLastChunk ? (
          <Button size="lg" onClick={goNextChunk} disabled={!canAdvance}>
            Continuer
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <span className="text-sm text-wrong">Enregistrement en cours…</span>
        ) : null}
        {phase === 'transcribing' ? (
          <span className="text-sm text-muted-foreground">Analyse (mots + phonèmes)…</span>
        ) : null}
      </div>

      {audioUrl ? <audio id="replay" className="mt-4 w-full" controls src={audioUrl} /> : null}

      {phase === 'idle' && !error ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          Lisez à voix haute uniquement les deux phrases affichées. Ensuite corrigez, écoutez le
          modèle, puis passez à l’étape suivante.
        </p>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-wrong">
          <p>{error}</p>
          <p className="mt-2 text-muted-foreground">
            Whisper : port 9000 · OpenPronounce : port 8000 (`docker compose up -d`).
          </p>
        </div>
      ) : null}

      {transcript ? (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl">Retour — mots</h3>
            {alignment ? (
              <p className="text-2xl font-semibold text-ring">
                {scoreLabel(alignment.score)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {alignment.matched}/{alignment.targetCount} mots
                  {wordPass ? ' · seuil OK' : ' · visez ≥ 70 % pour avancer sereinement'}
                </span>
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Transcription (Whisper)
            </p>
            <p className="text-sm leading-relaxed">{transcript}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              Correspondance mot à mot — vert = juste, rouge = faux ou manquant, gris = en trop
            </p>
            <FeedbackChips ops={alignment?.ops ?? []} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-serif text-xl">Prononciation</h3>
              {pronounceTips?.score != null ? (
                <p className="text-2xl font-semibold text-ring">
                  {Math.round(pronounceTips.score)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/ 100</span>
                </p>
              ) : null}
            </div>
            {pronounceNote ? (
              <p className="text-sm text-muted-foreground">{pronounceNote}</p>
            ) : null}
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
                        attendu /{err.expected}/ → entendu /{err.actual || '—'}/
                      </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => listenWord(err.word)}>
                      <Volume2 className="h-3.5 w-3.5" />
                      Écouter
                    </Button>
                  </li>
                ))}
              </ul>
            ) : !pronounceNote ? (
              <p className="text-sm text-muted-foreground">
                Aucun écart phonétique signalé sur ce tour — ou service encore en cours de
                chargement.
              </p>
            ) : null}
          </div>

          {phase === 'done' && isLastChunk ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-match">
              Passage terminé. Choisissez un autre texte, ou réessayez les étapes faibles.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
