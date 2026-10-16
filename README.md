# Coach de lecture française

Local reading practice for B2+ French: work **two sentences at a time**, correct them, then move on. Whisper checks which words you said; **OpenPronounce** scores pronunciation (IPA tips). Audio stays on your machine.

## What you get

- **Step-by-step reading**: each passage is split into pairs of sentences; advance after feedback
- **Whisper in Docker** (`base`, Faster Whisper, CPU) on port **9000** — word transcript
- **OpenPronounce in Docker** on port **8000** — phoneme-level French tips (experimental) + listen to the correct form via system TTS
- **Vite + React** app on **http://127.0.0.1:4378** (proxies `/asr` and `/pronunciation`)
- **12 original** B2+ paragraphs (100–200 words)
- Green = match, red = wrong or missing, gray = extra. Word score = matched / target words (aim ≥ 70 % before continuing)

## Requirements

- Docker Desktop
- Node.js 20+
- Chrome or Edge (microphone + `MediaRecorder` WebM)
- Apple Silicon M2 16GB is enough for Whisper `base`; OpenPronounce downloads ~2 GB of models on first start

## Run

From the repository root:

```bash
docker compose up -d --build
```

Wait until Whisper is ready (first launch can take several minutes). OpenPronounce’s first build/start is longer (image build + model download). Then:

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints (dev server on **http://127.0.0.1:4378**). Allow the microphone when prompted.

If only Whisper is up, word feedback still works; pronunciation tips show a clear message until the `pronounce` service is healthy. **Démo sans micro** exercises the highlighter on the first two-sentence step.

Useful checks:

```bash
docker compose ps
curl -s http://127.0.0.1:8000/health
```

## How practice works

1. Only **two sentences** are shown.
2. Record / Stop → Whisper transcribes; OpenPronounce compares expected vs heard phonemes.
3. Fix mismatches, tap **Écouter le modèle** (or **Écouter** on a word), then **Continuer**.
4. Tokenization keeps accents (`déjà` ≠ `deja`). Alignment uses Levenshtein on words.

## Layout

```
docker-compose.yml    Whisper (:9000) + OpenPronounce (:8000)
pronounce/            FastAPI wrapper around openpronounce (lang=fr)
web/                  Vite + React UI
  src/lib/chunks.js   Split passage → 2-sentence steps
  src/lib/pronounce.js  Client for /pronunciation
  src/lib/speak.js    Browser fr-FR TTS for the correct reading
```

## Models

| Role | Model | Notes |
| --- | --- | --- |
| Words | Faster Whisper `base` | Fast on CPU; good enough for short chunks |
| Pronunciation | [OpenPronounce](https://github.com/Halleck45/OpenPronounce) (Wav2Vec2 + espeak) | French is experimental; English is the calibrated language |
| Hear correct form | System `speechSynthesis` (`fr-FR`) | No network after voices are installed |
