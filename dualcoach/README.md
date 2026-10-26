# DualCoach

**Part of [Coach de lecture française](https://github.com/saket96/french-reading-coach)** — a Chrome extension (Manifest V3) with **dual subtitles** on YouTube and Netflix: learning language on top, your language below. Click any word for a definition; save vocabulary locally.

Same visual language as the reading coach: cream surfaces, forest-green accents (`#2f6f5e`).

## Features

- Dual subtitle lines (learn + native), synced to the video
- **YouTube** and **Netflix** (site-specific adapters)
- **Other / open video sites** with HTML5 `<video>` plus:
  - in-player subtitle tracks (WebVTT / TextTrack)
  - `<track src="…">` or on-page `.vtt` / `.srt` links
  - common players: Video.js, Plyr, MediaElement, JW Player-style wrappers
  - same-basename sidecar files (`movie.vtt`, `movie.fr.srt` — Archive.org style)
- Click a word → Wiktionary definition (+ on-device Chrome translate when needed)
- Optional AI explanations: **OpenRouter** (free `:free` models), Gemini, or Anthropic
- Transcript sidebar, line navigation, auto-pause, blur modes, TTS
- Vocabulary list with CSV / Anki export (stored in `chrome.storage.local`)

**Movie / embed sites (e.g. custom players):** open **Audio & Subtitles** and enable a caption track once. DualCoach sniffs `.vtt`/`.srt` network requests inside the player iframe and builds the Script panel from them.

**When a site has no captions**, open the Script panel (`T` or the Script button on the player) and use one of:

1. **OpenSubtitles** — Settings → API key **and** username/password (downloads need login JWT; otherwise you see `missing token`), then Script → Search / Load best dual
2. **Local files** — pick learning + translation `.srt` / `.vtt` from your computer → Load files
3. **Player CC** — turn captions on once so DualCoach can sniff the network file

On embed/movie sites the DualCoach UI lives **on the video player** (often inside an iframe), not in the browser chrome.

## Install (unpacked)

```bash
cd ~/french-reading-coach
git pull origin main
```

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `dualcoach` folder
4. Reload YouTube / Netflix tabs

No build step and no npm dependencies for the extension runtime.

### Optional: OpenRouter free AI

1. Key: https://openrouter.ai/keys  
2. Extension **Settings → AI explanations → OpenRouter (free models)**  
3. Paste key → **Test**  
4. Keep a model ending in `:free` (default: `meta-llama/llama-3.3-70b-instruct:free`)

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `A` | Previous line |
| `S` | Replay current line |
| `D` | Next line |
| `Q` | Toggle auto-pause after each line |
| `E` | Toggle blur translation |
| `T` | Show/hide the Script panel (Script + Vocab); also use the **Hide** button |
| `Alt` + `S` | Hide/show DualCoach subtitles |
| `Esc` | Close the word card, or hide the Script panel |

## Brand / icons

Icons use Coach de lecture française colors. Regenerate after design tweaks:

```bash
pip install Pillow   # once
python3 tools/make-icons.py
```

## Privacy

See [PRIVACY.md](PRIVACY.md). Contact: [saketsuman.com/contact](https://saketsuman.com/contact/).

## Development

```sh
node tools/test-parsers.mjs
node tools/test-wiktionary.mjs    # live Wiktionary
```

## Layout

- `manifest.json`, `_locales/`, `icons/`, `src/` — package these for Chrome
- `tools/package.sh` — builds `dist/dualcoach-<version>.zip`
- Sibling app: `../web` — Coach de lecture française (Docker reading coach)
