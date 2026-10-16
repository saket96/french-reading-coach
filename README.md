# Coach de lecture française

Local B2+ French reading coach: **record at your own pace**, get French-aware feedback after each 2-sentence step, optional guided listen, and vocabulary via Reverso Context. Whisper (`small`) + OpenPronounce run in Docker on your machine.

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

- **Écouter (guidé)** — optional TTS + word highlight (Lent / Moyen / Rapide)
- **Enregistrer** — speak at your own pace; feedback after Stop
- **Mon texte** — paste your own French
- **Vocabulary** — click a word for an FR→EN gloss; **Exemples Reverso** opens Reverso Context in your browser (Reverso’s API is blocked from Docker by Cloudflare)
- **Revue** — words, liaisons, terminaisons, phonemes after each step
- Docker services: Whisper `base` `:9000`, OpenPronounce `:8000`, web `:4378`

### If Whisper returns 502
```bash
docker compose ps
docker compose logs --tail=80 whisper
docker compose restart whisper
# wait ~30–60s for the model, then try again
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
```
- French-aware scoring: accents / genre / petites variantes ASR = « presque », pas une fausse erreur

## Requirements

- Docker Desktop
- Chrome or Edge (microphone + WebM)
- Internet for Reverso lookups
