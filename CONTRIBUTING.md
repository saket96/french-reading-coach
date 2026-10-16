# Contributing

Thanks for helping improve **Coach de lecture française**.

## Development setup

1. Follow [docs/INSTALL.md](docs/INSTALL.md) so Docker services run.
2. For UI-only work you can also run Vite on the host:

   ```bash
   cd web
   npm ci
   npm run dev
   ```

   Proxies in `web/vite.config.js` expect Whisper on `127.0.0.1:9000` and OpenPronounce on `127.0.0.1:8000` (start them with `docker compose up -d whisper pronounce`).

## Checks before opening a PR

```bash
cd web
npm test
npm run lint
npm run build
```

## Guidelines

- Prefer small, focused pull requests.
- Keep French UI copy clear for learners (B2+).
- Do not commit secrets, API keys, or personal recordings.
- Audio and ASR stay local by design; avoid adding cloud ASR unless optional and documented.
- Match existing code style (React + Vite, plain JS in `web/src`).

## Reporting issues

Include:

- OS (macOS / Windows / Linux) and version
- Docker version (`docker --version`, `docker compose version`)
- Browser
- Output of `docker compose ps`
- Relevant logs (`docker compose logs --tail=100 whisper` etc.)
- What you expected vs what happened
