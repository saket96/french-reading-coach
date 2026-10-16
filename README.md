# Coach de lecture française

Local reading practice for B2+ French: work **two sentences at a time**, correct them, then move on. Whisper checks which words you said; **OpenPronounce** scores pronunciation (IPA tips). Audio stays on your machine.

## What you get

- **Step-by-step reading**: each passage is split into pairs of sentences; advance after feedback
- **Whisper in Docker** (`base`, Faster Whisper, CPU) on port **9000** — word transcript
- **OpenPronounce in Docker** on port **8000** — phoneme-level French tips (experimental) + listen to the correct form via system TTS
- **Vite + React** app in Docker on **http://127.0.0.1:4378** (starts with `docker compose`; proxies `/asr` and `/pronunciation`)
- **12 original** B2+ paragraphs (100–200 words)
- Green = match, red = wrong or missing, gray = extra. Word score = matched / target words (aim ≥ 70 % before continuing)

## Requirements

- Docker Desktop
- Chrome or Edge (microphone + `MediaRecorder` WebM)
- Apple Silicon M2 16GB is enough for Whisper `base`; OpenPronounce downloads ~2 GB of models on first start

## Run (everything via Docker)

From the repository root:

```bash
docker compose up -d --build
```

This starts **Whisper**, **OpenPronounce**, and the **web app** (`npm run dev` inside the `web` container).

Open **http://127.0.0.1:4378**. Allow the microphone when prompted.

First launch can take several minutes (Whisper model + OpenPronounce image/models). If pronunciation tips are missing, wait until `pronounce` is healthy — word feedback still works with Whisper alone. **Démo sans micro** exercises the highlighter on the first two-sentence step.

Useful checks:

```bash
docker compose ps
docker compose logs -f web
curl -s http://127.0.0.1:8000/health
```

Stop everything:

```bash
docker compose down
```

### Optional: run the UI on the host instead

If you prefer a local Node install:

```bash
docker compose up -d whisper pronounce
cd web && npm install && npm run dev
```

## How practice works

1. Only **two sentences** are shown.
2. Record / Stop → Whisper transcribes; OpenPronounce compares expected vs heard phonemes.
3. Fix mismatches, tap **Écouter le modèle** (or **Écouter** on a word), then **Continuer**.
4. Tokenization keeps accents (`déjà` ≠ `deja`). Alignment uses Levenshtein on words.

## Layout

```
docker-compose.yml    Whisper (:9000) + OpenPronounce (:8000) + web (:4378)
pronounce/            FastAPI wrapper around openpronounce (lang=fr)
web/                  Vite + React UI (Dockerfile runs npm run dev)
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
