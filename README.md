# Coach de lecture française

Local reading practice for B2+ French: pick a passage, read it aloud, transcribe with Whisper on your machine, and see word-level mismatches. Audio never leaves the computer. This is not phoneme scoring.

## What you get

- **Whisper in Docker** (`base`, Faster Whisper, CPU) on port 9000
- **Vite + React** app that records WebM, proxies `/asr` to Whisper (no browser CORS), and scores with word-level Levenshtein
- **12 original** B2+ paragraphs (100–200 words): télétravail, transition écologique, IA, logement, santé mentale, alimentation, mobilité, éducation, vieillissement, désinformation, tourisme, francophonie
- Green = match, red = wrong or missing, gray = extra words. Score = matched / target words

## Requirements

- Docker Desktop
- Node.js 20+
- Chrome or Edge (microphone + `MediaRecorder` WebM)
- Apple Silicon M2 16GB is enough for the `base` model (first start downloads the weights into a named volume)

## Run

From the repository root:

```bash
docker compose up -d
```

Wait until Whisper is ready (first launch can take several minutes while `base` downloads). Then:

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints (dev server on **http://127.0.0.1:4378**). Allow the microphone when prompted.

If Docker is not running, the recorder still works: you get a clear error after Stop, and **Démo sans micro** exercises the highlighter with a fixture transcript.

## How scoring works

1. You read the large passage on screen.
2. Record / Stop sends `audio/webm` as multipart field `audio_file` to `/asr?task=transcribe&language=fr&output=json`.
3. The app tokenizes French by lowercasing and stripping punctuation only — accents stay (`déjà` ≠ `deja`).
4. Words are aligned with Levenshtein. Replay and Réessayer are always available after a take.

## Layout

```
docker-compose.yml    Whisper ASR (port 9000, model cache volume)
web/                  Vite + React UI (proxies /asr → :9000)
  src/passages.js     Original B2+ texts
  src/lib/            tokenize, align, Whisper client
```
