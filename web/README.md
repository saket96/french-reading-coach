# Web UI

Vite + React front end for **Coach de lecture française**.

The reading passage uses a **wide layout** (up to ~90rem) beside the floating **Outils** dock. **Écouter** follows the current word with highlight + auto-scroll on long texts; pick a French system voice in the dock.

## With Docker (recommended)

From the repository root:

```bash
docker compose up -d --build
```

Open http://127.0.0.1:4378

## Local Vite only

Start Whisper + OpenPronounce first (`docker compose up -d whisper pronounce`), then:

```bash
npm ci
npm run dev
```

Full install for Mac, Windows, and Linux: [../docs/INSTALL.md](../docs/INSTALL.md)  
Project overview: [../README.md](../README.md)
