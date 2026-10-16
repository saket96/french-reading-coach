import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleStop, Mic, RotateCcw, Sparkles, Volume2 } from 'lucide-react'
import { Button } from './components/ui/button.jsx'
import { FIXTURE_PASSAGE_ID, FIXTURE_TRANSCRIPT } from './fixtures.js'
import { alignWords } from './lib/align.js'
import { tokenizeFrench } from './lib/tokenize.js'
import { transcribeFrenchAudio, WhisperUnavailableError } from './lib/whisper.js'
import { passages } from './passages.js'

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
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [seconds, setSeconds] = useState(0)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  const passage = passages.find((item) => item.id === passageId) ?? passages[0]
  const alignment = useMemo(() => {
    if (!transcript) return null
    return alignWords(tokenizeFrench(passage.text), tokenizeFrench(transcript))
  }, [passage.text, transcript])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const resetAttempt = () => {
    setPhase('idle')
    setError('')
    setTranscript('')
    setSeconds(0)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl('')
    }
  }

  const onPassageChange = (nextId) => {
    setPassageId(nextId)
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
        if (audioUrl) URL.revokeObjectURL(audioUrl)
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
    setTranscript(FIXTURE_TRANSCRIPT)
    setPhase('done')
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
            Choisissez un texte B2+, lisez-le à voix haute, puis comparez votre transcription locale
            (Whisper) au passage. Rien ne quitte votre machine.
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
        className="mb-6 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
        value={passageId}
        onChange={(event) => onPassageChange(event.target.value)}
      >
        {passages.map((item) => (
          <option key={item.id} value={item.id}>
            {item.topic} — {item.title}
          </option>
        ))}
      </select>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{passage.topic}</p>
        <h2 className="mb-4 font-serif text-2xl">{passage.title}</h2>
        <p className="passage-text">{passage.text}</p>
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
            Enregistrer
          </Button>
        )}
        <Button variant="secondary" onClick={resetAttempt} disabled={phase === 'recording'}>
          <RotateCcw className="h-4 w-4" />
          Réessayer
        </Button>
        {audioUrl ? (
          <Button variant="outline" onClick={() => document.getElementById('replay')?.play()}>
            <Volume2 className="h-4 w-4" />
            Réécouter
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <span className="text-sm text-wrong">Enregistrement en cours…</span>
        ) : null}
        {phase === 'transcribing' ? (
          <span className="text-sm text-muted-foreground">Transcription en français…</span>
        ) : null}
      </div>

      {audioUrl ? <audio id="replay" className="mt-4 w-full" controls src={audioUrl} /> : null}

      {phase === 'idle' && !error ? (
        <p className="mt-6 rounded-lg border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          Aucune lecture pour l’instant. Enregistrez le passage, ou lancez la démo sans micro pour
          voir le correcteur.
        </p>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-wrong">
          <p>{error}</p>
          <p className="mt-2 text-muted-foreground">
            Whisper tourne en local via Docker sur le port 9000. S’il est arrêté, l’interface reste
            utilisable : changez de texte, relisez, ou lancez la démo.
          </p>
        </div>
      ) : null}

      {transcript ? (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl">Retour</h3>
            {alignment ? (
              <p className="text-2xl font-semibold text-ring">
                {scoreLabel(alignment.score)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {alignment.matched}/{alignment.targetCount} mots
                </span>
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Transcription
            </p>
            <p className="text-sm leading-relaxed">{transcript}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              Correspondance mot à mot — vert = juste, rouge = faux ou manquant, gris = en trop
            </p>
            <FeedbackChips ops={alignment?.ops ?? []} />
          </div>
        </section>
      ) : null}
    </div>
  )
}
