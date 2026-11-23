import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { Button } from './ui/button.jsx'
import { TCF_CATEGORIES, categoryMeta, listPracticeTasks } from '../lib/tcfTasks.js'
import {
  compareAttempts,
  listAttemptsForTask,
  listWeaknesses,
  savePracticeAttempt,
} from '../lib/practiceDb.js'
import { analyzeSpeechAttempt } from '../lib/speechAnalysis.js'
import { splitSentences } from '../lib/chunks.js'
import {
  pauseSpeaking,
  resumeSpeaking,
  speakFrench,
  stopSpeaking,
  PACE_PRESETS,
} from '../lib/speak.js'
import {
  pickRecorderMimeType,
  stopRecorderToBlob,
  MIN_AUDIO_BLOB_BYTES,
} from '../lib/recordAudio.js'
import { transcribeFrenchAudio } from '../lib/whisper.js'
import {
  assessFrenchPronunciation,
  extractPronunciationTips,
  PronounceUnavailableError,
} from '../lib/pronounce.js'

const MODES = [
  { id: 'listen-repeat', label: 'Écouter & répéter', hint: 'Une phrase à la fois — écoutez puis répétez.' },
  { id: 'shadow', label: 'Ombre (shadowing)', hint: 'Écoutez et parlez juste après (ou avec) le modèle.' },
  { id: 'complete', label: 'Lecture complète', hint: 'Lisez tout le texte naturellement, puis enregistrez.' },
]

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Lecture audio impossible'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Full-screen-ish panel for TCF pronunciation / speaking practice.
 * Reuses speak / record / Whisper / OpenPronounce — persists attempts locally.
 */
export function PronunciationPractice({
  open,
  onClose,
  voiceURI = '',
  speakingPace = 'moyen',
  whisperModel = 'base',
}) {
  const [step, setStep] = useState('select') // select | practice | result
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState([])
  const [task, setTask] = useState(null)
  const [mode, setMode] = useState('listen-repeat')
  const [sentenceIndex, setSentenceIndex] = useState(0)
  const [listening, setListening] = useState(false)
  const [paused, setPaused] = useState(false)
  const [activeSentence, setActiveSentence] = useState(-1)
  const [phase, setPhase] = useState('idle') // idle | recording | analyzing
  const [audioUrl, setAudioUrl] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [weaknesses, setWeaknesses] = useState([])
  const [error, setError] = useState('')
  const [compare, setCompare] = useState(null)
  const [busyList, setBusyList] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const recordStartedAt = useRef(0)
  const audioPlayerRef = useRef(null)

  const sentences = useMemo(() => splitSentences(task?.text || ''), [task?.text])
  const currentSentence = sentences[sentenceIndex] || ''
  const practiceText =
    mode === 'complete' ? task?.text || '' : currentSentence || task?.text || ''

  const rate = PACE_PRESETS[speakingPace]?.ttsRate ?? 0.78

  const refreshTasks = useCallback(async () => {
    setBusyList(true)
    try {
      const rows = await listPracticeTasks({ category, query })
      setTasks(rows)
    } catch (err) {
      setError(err.message || 'Impossible de charger les tâches')
    } finally {
      setBusyList(false)
    }
  }, [category, query])

  const refreshHistory = useCallback(async (taskId) => {
    if (!taskId) {
      setAttempts([])
      return
    }
    try {
      const rows = await listAttemptsForTask(taskId)
      setAttempts(rows)
      setWeaknesses(await listWeaknesses())
    } catch {
      setAttempts([])
    }
  }, [])

  useEffect(() => {
    if (!open) return
    refreshTasks()
    listWeaknesses().then(setWeaknesses).catch(() => setWeaknesses([]))
  }, [open, refreshTasks])

  useEffect(() => {
    return () => {
      stopSpeaking()
      stopMicTracks()
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopMicTracks() {
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop())
    } catch {
      // ignore
    }
    streamRef.current = null
  }

  function clearRecording() {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl('')
    setAudioBlob(null)
    setAnalysis(null)
    setCompare(null)
    setError('')
  }

  async function selectTask(row) {
    stopSpeaking()
    clearRecording()
    setTask(row)
    setSentenceIndex(0)
    setActiveSentence(-1)
    setMode('listen-repeat')
    setStep('practice')
    setPhase('idle')
    await refreshHistory(row.id)
  }

  async function playModel({ whole = false } = {}) {
    if (!task?.text) return
    setError('')
    setListening(true)
    setPaused(false)
    const text = whole || mode === 'complete' ? task.text : currentSentence
    const sentenceOffsets = []
    let offset = 0
    for (const s of sentences) {
      const at = task.text.indexOf(s, offset)
      sentenceOffsets.push({ start: at >= 0 ? at : offset, text: s })
      offset = (at >= 0 ? at : offset) + s.length
    }
    try {
      await speakFrench(text, {
        rate,
        voiceURI,
        onBoundary: (charIndex) => {
          if (!whole && mode !== 'complete') {
            setActiveSentence(sentenceIndex)
            return
          }
          const base = whole || mode === 'complete' ? 0 : 0
          const abs = base + charIndex
          let idx = 0
          for (let i = 0; i < sentenceOffsets.length; i += 1) {
            if (abs >= sentenceOffsets[i].start) idx = i
          }
          setActiveSentence(idx)
        },
      })
    } catch (err) {
      setError(err.message || 'Lecture audio impossible')
    } finally {
      setListening(false)
      setPaused(false)
      setActiveSentence(-1)
    }
  }

  function onPauseResume() {
    if (!listening) return
    if (paused) {
      resumeSpeaking()
      setPaused(false)
    } else {
      pauseSpeaking()
      setPaused(true)
    }
  }

  async function startRecording() {
    setError('')
    clearRecording()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickRecorderMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunksRef.current.push(event.data)
      }
      recorder.start(1000)
      recordStartedAt.current = Date.now()
      setPhase('recording')
    } catch (err) {
      setError(err.message || 'Micro indisponible — autorisez le micro dans le navigateur.')
      stopMicTracks()
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || (recorder.state !== 'recording' && recorder.state !== 'paused')) return
    try {
      const blob = await stopRecorderToBlob(recorder, chunksRef.current)
      stopMicTracks()
      mediaRecorderRef.current = null
      if (!blob || blob.size < MIN_AUDIO_BLOB_BYTES) {
        setError('Enregistrement trop court — réessayez.')
        setPhase('idle')
        return
      }
      const url = URL.createObjectURL(blob)
      setAudioBlob(blob)
      setAudioUrl(url)
      setPhase('idle')
    } catch (err) {
      setError(err.message || 'Arrêt de l’enregistrement impossible')
      setPhase('idle')
      stopMicTracks()
    }
  }

  async function submitForAnalysis() {
    if (!audioBlob || !task) return
    setPhase('analyzing')
    setError('')
    setAnalysis(null)
    const durationMs = Math.max(0, Date.now() - (recordStartedAt.current || Date.now()))
    try {
      const asr = await transcribeFrenchAudio(audioBlob, { model: whisperModel })
      let pronounceTips = null
      let pronounceNote = ''
      try {
        const raw = await assessFrenchPronunciation(audioBlob, practiceText)
        pronounceTips = extractPronunciationTips(raw)
      } catch (err) {
        if (err instanceof PronounceUnavailableError) {
          pronounceNote = err.message
        } else {
          pronounceNote = err.message || 'OpenPronounce indisponible'
        }
      }
      const result = analyzeSpeechAttempt({
        expectedText: practiceText,
        transcript: asr?.text || '',
        pronounceTips,
        whisperWords: asr?.words || [],
        durationMs,
      })
      if (pronounceNote) {
        result.pronunciation.note = pronounceNote
        // Missing OpenPronounce → keep the Whisper-normalized flag for the UI warning.
        if (result.pronunciation.score == null || result.pronunciation.source !== 'openpronounce') {
          result.pronunciation.whisperNormalized = true
          result.pronunciation.source = result.pronunciation.source || 'whisper-estimate'
        }
      }
      setAnalysis(result)

      let audioDataUrl = null
      try {
        // Keep small clips only (avoid huge IDB payloads)
        if (audioBlob.size < 1_500_000) audioDataUrl = await blobToDataUrl(audioBlob)
      } catch {
        audioDataUrl = null
      }

      const saved = await savePracticeAttempt({
        taskId: task.id,
        mode,
        expectedText: practiceText,
        transcript: asr?.text || '',
        analysis: result,
        audioDataUrl,
        durationMs,
      })
      const history = await listAttemptsForTask(task.id)
      setAttempts(history)
      setWeaknesses(await listWeaknesses())
      const prev = history.filter((a) => a.id !== saved.id).at(-1)
      setCompare(compareAttempts(prev, saved))
      setStep('result')
    } catch (err) {
      setError(err.message || 'Analyse impossible — vérifiez Whisper.')
    } finally {
      setPhase('idle')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/35">
      <div
        className="flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl"
        role="dialog"
        aria-label="Pratique TCF — Prononciation & oral"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-ring uppercase">
              TCF · Prononciation & oral
            </p>
            <h2 className="truncate font-serif text-xl">
              {step === 'select'
                ? 'Choisir une tâche'
                : step === 'result'
                  ? 'Retour d’analyse'
                  : task?.title || 'Pratique'}
            </h2>
          </div>
          <div className="flex gap-2">
            {step !== 'select' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  stopSpeaking()
                  setStep(step === 'result' ? 'practice' : 'select')
                }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Retour
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                stopSpeaking()
                stopMicTracks()
                onClose?.()
              }}
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <p className="mb-3 rounded-md border border-wrong/40 bg-wrong/10 px-3 py-2 text-sm text-wrong">
              {error}
            </p>
          ) : null}

          {step === 'select' ? (
            <SelectStep
              category={category}
              setCategory={setCategory}
              query={query}
              setQuery={setQuery}
              tasks={tasks}
              busy={busyList}
              onRefresh={refreshTasks}
              onSelect={selectTask}
              weaknesses={weaknesses}
            />
          ) : null}

          {step === 'practice' && task ? (
            <PracticeStep
              task={task}
              mode={mode}
              setMode={setMode}
              sentences={sentences}
              sentenceIndex={sentenceIndex}
              setSentenceIndex={setSentenceIndex}
              activeSentence={activeSentence}
              listening={listening}
              paused={paused}
              phase={phase}
              audioUrl={audioUrl}
              audioPlayerRef={audioPlayerRef}
              attempts={attempts}
              onPlayModel={playModel}
              onPauseResume={onPauseResume}
              onStopSpeak={() => {
                stopSpeaking()
                setListening(false)
                setPaused(false)
              }}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onClearRecording={clearRecording}
              onSubmit={submitForAnalysis}
            />
          ) : null}

          {step === 'result' && analysis ? (
            <ResultStep
              analysis={analysis}
              compare={compare}
              attempts={attempts}
              weaknesses={weaknesses}
              onRetry={() => {
                clearRecording()
                setStep('practice')
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SelectStep({
  category,
  setCategory,
  query,
  setQuery,
  tasks,
  busy,
  onRefresh,
  onSelect,
  weaknesses,
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sélectionnez un texte déjà dans l’app (bibliothèque B2+ ou{' '}
        <strong>Mes travaux</strong>) pour écouter, faire de l’ombre, enregistrer et suivre vos
        faiblesses.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={category === 'all' ? 'default' : 'outline'}
          onClick={() => setCategory('all')}
        >
          Tous
        </Button>
        {TCF_CATEGORIES.map((cat) => (
          <Button
            key={cat.id}
            size="sm"
            variant={category === cat.id ? 'default' : 'outline'}
            onClick={() => setCategory(cat.id)}
            title={cat.description}
          >
            {cat.short}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          placeholder="Rechercher un titre ou un thème…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="outline" onClick={onRefresh} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5" />
          Actualiser
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {tasks.map((row) => {
          const meta = categoryMeta(row.category)
          return (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 px-3 py-3 text-left hover:bg-muted/60"
                onClick={() => onSelect(row)}
              >
                <span className="text-[11px] font-semibold tracking-wide text-ring uppercase">
                  {meta?.label || row.category}
                  {row.sourceType === 'work' ? ' · Mes travaux' : ''}
                </span>
                <span className="font-medium">{row.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {row.prompt || row.text}
                </span>
              </button>
            </li>
          )
        })}
        {!tasks.length && !busy ? (
          <li className="px-3 py-6 text-sm text-muted-foreground">
            Aucune tâche. Sauvez un texte dans Mes travaux, ou choisissez une autre catégorie.
          </li>
        ) : null}
      </ul>

      {weaknesses.length ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <h3 className="text-sm font-semibold">Faiblesses récurrentes</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {weaknesses.slice(0, 8).map((w) => (
              <li key={w.id} className="flex justify-between gap-2">
                <span>
                  {w.label}
                  <span className="text-muted-foreground"> · {w.kind}</span>
                </span>
                <span className="text-muted-foreground">×{w.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function PracticeStep({
  task,
  mode,
  setMode,
  sentences,
  sentenceIndex,
  setSentenceIndex,
  activeSentence,
  listening,
  paused,
  phase,
  audioUrl,
  audioPlayerRef,
  attempts,
  onPlayModel,
  onPauseResume,
  onStopSpeak,
  onStartRecording,
  onStopRecording,
  onClearRecording,
  onSubmit,
}) {
  const meta = categoryMeta(task.category)
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{meta?.label}</p>
        <p className="font-medium">{task.title}</p>
        {task.prompt ? <p className="mt-1 text-muted-foreground">{task.prompt}</p> : null}
        {attempts.length ? (
          <p className="mt-1 text-xs text-muted-foreground">{attempts.length} tentative(s) sauvée(s)</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <Button
            key={m.id}
            size="sm"
            variant={mode === m.id ? 'default' : 'outline'}
            onClick={() => setMode(m.id)}
            title={m.hint}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)?.hint}</p>

      {mode !== 'complete' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={sentenceIndex <= 0}
            onClick={() => setSentenceIndex((i) => Math.max(0, i - 1))}
          >
            Phrase préc.
          </Button>
          <span className="text-sm text-muted-foreground">
            Phrase {Math.min(sentenceIndex + 1, sentences.length)} / {sentences.length || 1}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={sentenceIndex >= sentences.length - 1}
            onClick={() => setSentenceIndex((i) => Math.min(sentences.length - 1, i + 1))}
          >
            Phrase suiv.
          </Button>
        </div>
      ) : null}

      <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3 font-serif text-[15px] leading-relaxed sm:text-base">
        {sentences.map((sentence, idx) => {
          const highlight =
            activeSentence === idx || (mode !== 'complete' && sentenceIndex === idx && activeSentence < 0)
          return (
            <p
              key={idx}
              className={
                'rounded px-1 ' +
                (highlight ? 'bg-ring/15 text-foreground' : 'text-foreground/90')
              }
            >
              {sentence}
            </p>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => onPlayModel({ whole: mode === 'complete' })}
          disabled={listening && !paused}
        >
          <Volume2 className="h-4 w-4" />
          {mode === 'complete' ? 'Écouter tout' : 'Écouter la phrase'}
        </Button>
        <Button variant="outline" onClick={onPauseResume} disabled={!listening}>
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? 'Reprendre' : 'Pause'}
        </Button>
        <Button variant="outline" onClick={onStopSpeak} disabled={!listening && !paused}>
          Stop
        </Button>
        <Button variant="secondary" onClick={() => onPlayModel({ whole: false })} disabled={!sentences.length}>
          <RotateCcw className="h-4 w-4" />
          Rejouer phrase
        </Button>
      </div>

      <div className="rounded-lg border border-dashed border-border p-3">
        <p className="mb-2 text-sm font-medium">Enregistrement</p>
        <div className="flex flex-wrap gap-2">
          {phase !== 'recording' ? (
            <Button onClick={onStartRecording} disabled={phase === 'analyzing'}>
              <Mic className="h-4 w-4" />
              Enregistrer
            </Button>
          ) : (
            <Button variant="destructive" onClick={onStopRecording}>
              <Square className="h-4 w-4" />
              Stop micro
            </Button>
          )}
          <Button variant="outline" onClick={onClearRecording} disabled={!audioUrl || phase === 'recording'}>
            <Trash2 className="h-4 w-4" />
            Effacer
          </Button>
          <Button
            variant="default"
            onClick={onSubmit}
            disabled={!audioUrl || phase === 'recording' || phase === 'analyzing'}
          >
            {phase === 'analyzing' ? 'Analyse…' : 'Soumettre à l’analyse'}
          </Button>
        </div>
        {audioUrl ? (
          <audio ref={audioPlayerRef} className="mt-3 w-full" controls src={audioUrl} />
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Enregistrez, réécoutez, puis soumettez. OpenPronounce (voyant Prononciation vert) juge
            les sons ; Whisper sert surtout à la fluidité. Sans Prononciation :{' '}
            <code className="text-[11px]">docker compose up -d pronounce</code>.
          </p>
        )}
      </div>
    </div>
  )
}

function ResultStep({ analysis, compare, attempts, weaknesses, onRetry }) {
  const pron = analysis.pronunciation
  const rawAlign = Number(analysis.alignment?.score)
  const alignScore = Number.isFinite(rawAlign) ? (rawAlign <= 1 ? Math.round(rawAlign * 100) : Math.round(rawAlign)) : NaN
  const whisperLooksGood = Number.isFinite(alignScore) && alignScore >= 85
  const openScoreLow =
    pron?.source === 'openpronounce' && Number.isFinite(Number(pron?.score)) && Number(pron.score) < 75
  const whisperNormalized = Boolean(pron?.whisperNormalized)
  const showWhisperNormNotice = whisperNormalized || (whisperLooksGood && openScoreLow)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ring/30 bg-ring/10 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Score global</p>
        <p className="font-serif text-3xl">
          {analysis.overallScore != null ? `${analysis.overallScore}/100` : '—'}
        </p>
        <p className="mt-1 text-sm">{analysis.summary}</p>
        {compare?.delta != null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            vs tentative précédente :{' '}
            <strong className={compare.improved ? 'text-emerald-700' : compare.improved === false ? 'text-wrong' : ''}>
              {compare.delta > 0 ? '+' : ''}
              {compare.delta}
            </strong>
            {compare.previousScore != null ? ` (${compare.previousScore} → ${compare.currentScore})` : ''}
          </p>
        ) : null}
      </div>

      {showWhisperNormNotice ? (
        <div className="rounded-lg border border-amber-700/35 bg-amber-50 px-3 py-3 text-sm text-foreground">
          <p className="font-medium">Whisper ≠ bonne prononciation</p>
          <p className="mt-1 text-muted-foreground">
            {whisperNormalized
              ? 'Whisper « normalise » souvent l’orthographe même quand les sons sont imprécis. Le score de prononciation ci-dessous est une estimation pénalisée — ce n’est pas un vrai jugement phonémique.'
              : 'La transcription Whisper colle au texte, mais OpenPronounce signale encore des écarts de sons. Priorisez les conseils phonémiques, pas le match texte.'}
          </p>
          {whisperNormalized ? (
            <p className="mt-2 text-muted-foreground">
              Démarrez le service Prononciation :{' '}
              <code className="text-xs">docker compose up -d pronounce</code>
              {' '}puis attendez le voyant Prononciation vert.
            </p>
          ) : null}
        </div>
      ) : null}

      <Section
        title="Prononciation (prioritaire)"
        score={pron?.score}
        emphasize
        badge={
          pron?.source === 'openpronounce'
            ? 'OpenPronounce'
            : whisperNormalized
              ? 'estimation Whisper'
              : null
        }
      >
        {pron?.note ? <p className="mb-2 text-sm text-muted-foreground">{pron.note}</p> : null}
        <p className="text-sm text-muted-foreground">{pron?.clarity}</p>
        <IssueList items={pron?.issues} emptyLabel="Aucun écart phonémique signalé sur cet essai." />
      </Section>
      <Section title="Fluidité" score={analysis.fluency?.score}>
        <p className="text-sm text-muted-foreground">
          {analysis.fluency?.naturalness}
          {analysis.fluency?.wpm != null ? ` · ~${analysis.fluency.wpm} mots/min` : ''}
        </p>
        <IssueList items={analysis.fluency?.issues} />
      </Section>
      <Section title="Grammaire (à l’oral)" score={analysis.grammar?.score}>
        <p className="text-sm text-muted-foreground">{analysis.grammar?.note}</p>
        <IssueList items={analysis.grammar?.issues} />
      </Section>
      <Section title="Vocabulaire / mots manquants" score={analysis.vocabulary?.score}>
        <IssueList items={analysis.vocabulary?.issues} />
      </Section>
      <Section title="Rappel / écoute" score={analysis.listeningRecall?.score}>
        <p className="text-sm text-muted-foreground">{analysis.listeningRecall?.detail}</p>
      </Section>

      {analysis.comparedToExpected?.wrongWords?.length ? (
        <div className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Écarts modèle ↔ oral (transcription Whisper)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Un match Whisper correct ne remplace pas le score de prononciation ci-dessus.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {analysis.comparedToExpected.wrongWords.slice(0, 10).map((w, i) => (
              <li key={i}>
                <span className="text-ring">{w.expected}</span>
                <span className="text-muted-foreground"> → </span>
                <span>{w.heard || '∅'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : whisperLooksGood ? (
        <div className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Transcription Whisper</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Bon match texte ({Math.round(alignScore)}/100) — utile pour fluidité / mots manquants, pas
            pour juger les phonèmes.
          </p>
        </div>
      ) : null}

      {weaknesses?.length ? (
        <div className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Suivi des faiblesses</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {weaknesses.slice(0, 10).map((w) => (
              <li key={w.id}>
                {w.label} <span className="text-muted-foreground">×{w.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">{attempts.length} tentative(s) au total pour cette tâche.</p>

      <Button onClick={onRetry}>
        <RotateCcw className="h-4 w-4" />
        Réessayer la tâche
      </Button>
    </div>
  )
}

function Section({ title, score, children, emphasize = false, badge = null }) {
  return (
    <section
      className={
        emphasize
          ? 'rounded-lg border border-ring/40 bg-ring/5 p-3'
          : 'rounded-lg border border-border p-3'
      }
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge ? (
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {badge}
            </span>
          ) : null}
        </div>
        {score != null ? (
          <span className={emphasize ? 'font-serif text-lg' : 'text-sm text-muted-foreground'}>
            {Math.round(score)}/100
          </span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function IssueList({ items, emptyLabel = 'Rien de critique ici.' }) {
  if (!items?.length) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>
          <strong>{item.label}</strong>
          {item.detail ? ` — ${item.detail}` : ''}
        </li>
      ))}
    </ul>
  )
}
