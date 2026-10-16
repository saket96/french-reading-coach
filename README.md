# Coach de lecture française

Local B2+ French reading coach: **guided listen/read** (word highlight), **2-sentence steps**, pronunciation review, and **Reverso** vocabulary (FR→EN). Whisper + OpenPronounce run in Docker on your machine.

## Run on your Mac

```bash
cd ~/french-reading-coach
git fetch origin
git checkout main
git reset --hard origin/main

docker compose down
docker compose up -d --build
```

Open **http://127.0.0.1:4378**

```bash
docker compose ps
docker compose logs -f web
```

Stop: `docker compose down`

## What you get

- **Écouter (guidé)** — TTS + word highlight as it speaks
- **Enregistrer (guidé)** — highlight advances while you read aloud
- **Mon texte** — paste your own French
- **Vocabulary** — click a word for an FR→EN gloss; **Exemples Reverso** opens Reverso Context in your browser (Reverso’s API is blocked from Docker by Cloudflare)
- **Revue** — words, liaisons, terminaisons, phonemes after each step
- Docker services: Whisper `:9000`, OpenPronounce `:8000`, web `:4378`

## Requirements

- Docker Desktop
- Chrome or Edge (microphone + WebM)
- Internet for Reverso lookups
