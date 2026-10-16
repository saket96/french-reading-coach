# Coach de lecture française

Local reading practice for B2+ French: **two sentences at a time**, focused review (words, **liaisons**, **terminaisons**), hear your mistakes, and build **vocabulary with Google Translate**. Whisper + OpenPronounce stay on your machine; Translate needs the network.

## What you get

- **Mon texte** — paste or write your own French, listen, then practice in 2-sentence steps
- **Revue après chaque étape** — what to focus on next (words, liaisons, endings, phonemes)
- **Écouter vos erreurs** — model voice + “ce que j’ai dit” (clip from your recording when timestamps exist)
- **Vocabulaire** — click any word → Google Translate (FR→EN) → save to a local notebook
- **Whisper** (`:9000`) + **OpenPronounce** (`:8000`) + **Vite** (`:4378`) via Docker

## Requirements

- Docker Desktop
- Chrome or Edge (mic + WebM)
- Internet for Google Translate lookups (optional; the rest works offline)

## Run / update

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

## How to practice

1. Pick **Bibliothèque** or **Mon texte**
2. **Écouter le modèle** → **Enregistrer** → read the **Revue**
3. On wrong words: **Modèle** / **Ce que j’ai dit**
4. Click a word → Translate → **Sauver** in Vocabulaire

## Layout

```
docker-compose.yml
pronounce/           OpenPronounce API
web/                 Vite app
  src/lib/chunks.js  2-sentence steps
  src/lib/liaison.js Liaisons + terminaisons
  src/lib/review.js  Post-task focus review
  src/lib/translate.js  Google Translate (gtx)
  src/lib/vocabulary.js Local word notebook
```
