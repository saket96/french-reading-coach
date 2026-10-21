# Coach de lecture française

**English** · **[Français](README.fr.md)**

**Open-source, local-first French reading coach** for B2+ learners.

Record yourself reading French (or **shadow** one sentence), get French-aware word feedback, optional phoneme tips, a Whisper ready light with Base/Small models, click-to-translate, and a Leitner **vocab review deck**. Speech recognition and pronunciation scoring run in **Docker on your computer** — no account required.

| | |
|---|---|
| **Author** | [Saket Suman](https://saketsuman.com) |
| **Need help?** | [Contact](https://saketsuman.com/contact/) |
| **App (local)** | http://127.0.0.1:4378 |
| **License** | [MIT](LICENSE) |
| **Install (Mac / Windows / Linux)** | [docs/INSTALL.md](docs/INSTALL.md) · [Français](docs/INSTALL.fr.md) |
| **YouTube / Netflix dual subs** | **[DualCoach](dualcoach/)** — companion extension for this coach (OpenRouter free AI optional) |
| **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Security / privacy** | [SECURITY.md](SECURITY.md) |

---

## Features

- **Whisper ready light** — green when the selected ASR model answers
- **Base / Small toggle** — Base on port `9000`; optional Small on `9001`
- **Ombre (shadowing)** — one sentence: listen → record → feedback
- **Écouter tout / guidé** — French system voice with word highlight; long texts **auto-scroll** to follow the current word
- **Pause / Reprendre / Suivant** — pause listening anytime; guided mode plays **one sentence at a time**, then **Suivant**
- **Voix française** — pick a native French TTS voice (Amélie / Thomas Enhanced recommended)
- **In-app help (?)** — floating help on the left with full usage instructions
- **Wide reading panel** — passage uses most of the screen beside the floating **Outils** dock
- **Free recording** — speak at your own pace (two sentences when Ombre is off)
- **French-aware scoring** — exact / presque / wrong (fewer false alarms)
- **Clic mot / phrase** — turn **Clic ON**, then tap a word or a whole line to hear + translate; mouse-select any span
- **Révision** — Leitner-style deck from saved vocabulary
- **Mes travaux** — simple local database (IndexedDB): save texts, rename titles, reopen later; **Export / Import** JSON to move data between browsers (Opera ≠ Safari)
- **Mon texte** — paste, type, or import **PDF / Word (.docx)** (spacing preserved; review text before use)
- **OpenPronounce** — optional phoneme-level tips (experimental for French)

---

## System requirements

### All platforms

| Requirement | Details |
|-------------|---------|
| **RAM** | **8 GB minimum**, **16 GB recommended** (Whisper + OpenPronounce) |
| **Disk** | **10 GB free** minimum; **20 GB+** if you enable Whisper Small |
| **CPU** | Modern multi-core (models run on **CPU** by default; no GPU required) |
| **Browser** | **Chrome**, **Edge**, or **Opera** for recording (WebM mic). **Safari** works well for **Écouter** (TTS); recording is more reliable on Chromium |
| **Microphone** | Built-in or USB mic; allow browser permission |
| **Network** | Needed for first Docker image/model download; vocab gloss may call online lookup APIs |
| **Docker** | Docker Desktop (Mac/Windows) or Docker Engine + Compose (Linux) |
| **Git** | To clone and update the repository |

### Ports used (localhost)

| Port | Service |
|------|---------|
| `4378` | Web UI (Vite) |
| `9000` | Whisper **Base** ASR |
| `9001` | Whisper **Small** ASR (optional) |
| `8000` | OpenPronounce |

Do **not** expose these ports to the public internet without hardening. This app is designed for **local practice**.

### By operating system

| OS | Minimum | Notes |
|----|---------|--------|
| **macOS** | 12+ | Intel or Apple Silicon; Docker Desktop |
| **Windows** | 10 64-bit (22H2+) or 11 | **WSL 2** required for Docker Desktop |
| **Linux** | Ubuntu 22.04+ / Debian 12+ / Fedora 39+ (or similar) | Docker Engine + Compose plugin; user in `docker` group |

Full step-by-step setup: **[docs/INSTALL.md](docs/INSTALL.md)**.

---

## Quick start

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
```

1. Wait for Whisper (often 30–90 seconds after first start):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
   ```

   You want `200`.

2. Open **http://127.0.0.1:4378** in Chrome or Edge.
3. Allow the microphone when asked.
4. Optional higher-accuracy ASR:

   ```bash
   docker compose --profile small up -d
   ```

   Then choose **Small** in the app and wait for the green light.

Stop everything:

```bash
docker compose down
```

---

## Install by device

### macOS

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and start it.
2. Install Git (`xcode-select --install` or Homebrew).
3. Clone and run:

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
open http://127.0.0.1:4378
```

4. For guided listen audio: **System Settings → Accessibility → Spoken Content** → download a **French** voice.

More detail: [docs/INSTALL.md § macOS](docs/INSTALL.md#macos).

### Windows

1. Enable **WSL 2** (PowerShell as Administrator: `wsl --install`, then reboot if asked).
2. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) with the **WSL 2** backend; start Docker until **Engine running**.
3. Install [Git for Windows](https://git-scm.com/download/win).
4. In PowerShell or Git Bash:

```powershell
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
```

5. Open **http://127.0.0.1:4378** in Chrome or Edge and allow the mic.

More detail: [docs/INSTALL.md § Windows](docs/INSTALL.md#windows).

### Linux

1. Install [Docker Engine](https://docs.docker.com/engine/install/) and the **Compose plugin**; add your user to the `docker` group and re-login.
2. Install Git and Chrome/Chromium/Edge.
3. Run:

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
docker compose up -d --build
xdg-open http://127.0.0.1:4378
```

More detail: [docs/INSTALL.md § Linux](docs/INSTALL.md#linux).

---

## How to use (short)

1. Open the **?** help button on the left for the full guide anytime.
2. Pick a **Bibliothèque** passage, or open **Mon texte** to paste/type French, or import a **PDF / Word (.docx)** → check the text → **Utiliser ce texte**.
3. In the floating **Outils** dock: choose a **Voix française**, click **Tester la voix**, set speed (**Lent / Moyen / Rapide**).
4. **Écouter tout** plays the full passage (highlight + auto-scroll). **Écouter (guidé)** plays **one sentence at a time**; use **Suivant** for the next line. **Pause** / **Reprendre** mid-playback; **Stop écoute** to cancel.
5. Optional: turn on **Ombre** for one-sentence shadowing — listen, then **Enregistrer**.
6. Watch the **Whisper** light — prefer **Base** until it is green; use **Small** only after `docker compose --profile small up -d`.
7. After Stop, read the revue (words, focus items, pronunciation tips).
8. Turn **Clic ON** (**Mot** or **Phrase**) to tap or select → hear + translate → **Réécouter** / **Sauver**; open **Révision** to drill the deck. **Mes travaux** saves texts locally.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Page won’t load | `docker compose ps` — ensure `web` is up; open http://127.0.0.1:4378 |
| Whisper red / 502 | Wait 1–2 min after start; `docker compose restart whisper`; check `curl http://127.0.0.1:9000/docs` |
| Small model errors | `docker compose --profile small up -d` then `docker compose restart web`; check port `9001` |
| Mic blocked | Chrome/Edge/Opera site settings → allow microphone; use http://127.0.0.1 |
| No guided voice / silent Écouter | Install a **French** system voice (Mac: Accessibility → Spoken Content → Amélie or Thomas Enhanced). In the dock, pick that voice and **Tester la voix**. Opera/Chrome need a click before speech; Safari is usually fine. Prefer a **local / Enhanced** voice over remote Google voices. |
| Listen highlight but no sound | Same as above; also try another browser (Safari for listen, Chrome/Opera for record). |
| Pronunciation tip missing / flaky | Rebuild pronounce (uses **offline Piper**, not Google TTS): `docker compose up -d --build pronounce`. Wait until the **Prononciation** light is green (first run downloads ~1.2 GB FR model + Piper voice). Click **Reset** then re-record. Check `docker compose logs -f pronounce`. |
| Vite error `Failed to resolve import "pdfjs-dist"` | After pulling new deps: `docker compose down && docker compose up -d --build`. If it persists: `docker volume rm french-reading-coach_web_node_modules` then `docker compose up -d --build`. |
| PDF import is one run-on block / no spaces | Pull latest `main` (spacing fix). Re-import the PDF. Scanned image-only PDFs still cannot extract text — paste instead. |
| Click / select does nothing | Turn **Clic ON** in the right-hand dock first. |

```bash
docker compose logs -f web
docker compose logs --tail=80 whisper
docker compose restart web
```

---

## Privacy

- **Recording & ASR** stay on your machine (Docker).
- **Vocab / deck** stay in browser `localStorage`.
- Word lookup may use online gloss / Reverso Context links.
- See [SECURITY.md](SECURITY.md).

---

## Updating

```bash
cd french-reading-coach
git checkout main
git pull origin main
docker compose down
docker compose up -d --build
```

---

## Development

```bash
cd web
npm ci
npm test
npm run lint
npm run build
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Author

Created by **[Saket Suman](https://saketsuman.com)**.

## Need help?

Questions about install, listen/record, or using the coach — reach out here:  
**[https://saketsuman.com/contact/](https://saketsuman.com/contact/)**

## License

[MIT](LICENSE) — free to use, share, and modify with attribution.

Third-party components (Whisper ASR webservice images, OpenPronounce, fonts, lookup APIs) keep their own licenses and terms.
