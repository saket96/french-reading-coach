# Coach de lecture française

Local B2+ French reading coach: record at your own pace (or **shadow** one sentence), French-aware feedback, Whisper ready light + Base/Small toggle, and a **vocab review deck**. Whisper + OpenPronounce run in Docker.

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

Optional higher-accuracy Whisper (`small` on port 9001):

```bash
docker compose --profile small up -d
```

Then in the app choose **Small**.

```bash
docker compose ps
docker compose logs -f web
```

Stop: `docker compose down`

### If Whisper returns 502
```bash
docker compose ps
docker compose logs --tail=80 whisper
docker compose restart whisper
# wait ~30–60s for the model, then try again
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
```

## What you get

- **Whisper ready light** — green when the selected model answers
- **Base / Small toggle** — Base always on `:9000`; Small via `--profile small` on `:9001`
- **Ombre** — one sentence: listen → record → feedback
- **Enregistrer** — speak freely (2 sentences when Ombre is off)
- **Révision** — Leitner-style vocab deck from saved words
- **Clic mot** — pronounce + translate bar (optional)
- French-aware scoring (exact / presque / wrong)
- Docker: Whisper, optional Whisper-small, OpenPronounce `:8000`, web `:4378`

## Requirements

- Docker Desktop
- Chrome or Edge (microphone + WebM)
- Internet for vocabulary gloss / Reverso Context
