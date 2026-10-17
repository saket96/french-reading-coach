# Installation guide

Step-by-step setup for **macOS**, **Windows**, and **Linux**.  
For a shorter overview, see the [root README](../README.md).

---

## Before you start (all platforms)

1. Install a browser:
   - **Recording**: [Google Chrome](https://www.google.com/chrome/), [Microsoft Edge](https://www.microsoft.com/edge), or [Opera](https://www.opera.com/) (WebM microphone).
   - **Écouter (TTS)**: Safari on Mac also works well; Chromium browsers need a French **local** voice and a click (**Tester la voix**).
2. Install **Git**.
3. Install **Docker** (Desktop on Mac/Windows, Engine + Compose on Linux).
4. Free roughly **10–20 GB** of disk for images and speech models (more if you enable Whisper **Small**).
5. Have a working **microphone** and allow the browser to use it when prompted.

Clone the repository once you have Git:

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
```

On Windows, run the same commands in **PowerShell** or **Git Bash** after installing Git and Docker Desktop.

---

## macOS

### 1. System requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| OS | macOS 12+ | macOS 13+ |
| Chip | Intel or Apple Silicon | Apple Silicon OK (Docker Desktop) |
| RAM | 8 GB | 16 GB |
| Disk free | 10 GB | 20 GB+ |
| Docker | [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) | Latest stable |
| Browser | Chrome or Edge | Latest |
| Git | Xcode CLT or [git-scm](https://git-scm.com/) | Latest |

### 2. Install Docker Desktop

1. Download Docker Desktop for Mac (Apple Silicon or Intel build matching your Mac).
2. Open the installer and drag Docker to Applications.
3. Launch **Docker** and wait until the whale icon shows Docker is running.
4. (Optional) Give Docker at least **4 GB RAM** and **2 CPUs** in Settings → Resources.

### 3. Install Git (if needed)

```bash
xcode-select --install
# or: brew install git
git --version
```

### 4. Start the app

```bash
cd ~/french-reading-coach   # or wherever you cloned
git checkout main
git pull origin main

docker compose down
docker compose up -d --build
```

First build can take several minutes (Whisper + OpenPronounce + web).

### 5. Open the coach

1. Wait until Whisper is ready (often 30–90 seconds after containers start):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
   ```

   Expect `200`.

2. Open **http://127.0.0.1:4378** in Chrome, Edge, Opera, or Safari.
3. Allow microphone access when the browser asks (needed for **Enregistrer**).
4. For French TTS (**Écouter tout / guidé**): **System Settings → Accessibility → Spoken Content** (or *Content spoken aloud*) → download **Amélie** or **Thomas** (Enhanced / Premium). In the app dock (**Voix française**), select that voice and click **Tester la voix**.

### 6. Optional: Whisper Small

```bash
docker compose --profile small up -d
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9001/docs
```

In the app, choose **Small** and wait for the green ready light.

### 7. Stop

```bash
docker compose down
```

---

## Windows

### 1. System requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| OS | Windows 10 64-bit (22H2+) or Windows 11 | Windows 11 |
| Virtualization | WSL 2 enabled | WSL 2 + virtualization in BIOS/UEFI |
| RAM | 8 GB | 16 GB |
| Disk free | 10 GB | 20 GB+ |
| Docker | [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) | Latest, **WSL 2 backend** |
| Browser | Chrome or Edge | Latest |
| Git | [Git for Windows](https://git-scm.com/download/win) | Latest |

> **Note:** Firefox is not recommended for recording (WebM mic). Safari can be used for **Écouter**; prefer Chrome/Edge/Opera for **Enregistrer**.

### 2. Enable WSL 2 (required by Docker Desktop)

In **PowerShell as Administrator**:

```powershell
wsl --install
```

Restart Windows if prompted. Confirm:

```powershell
wsl --status
```

### 3. Install Docker Desktop

1. Install Docker Desktop for Windows.
2. During setup, keep **Use WSL 2 instead of Hyper-V** enabled.
3. Start Docker Desktop and wait until it says **Engine running**.
4. Settings → Resources: at least **4 GB RAM** recommended.

### 4. Install Git for Windows

1. Install from https://git-scm.com/download/win  
2. Use the default options (Git from the command line is fine).
3. Open **PowerShell** or **Git Bash**.

### 5. Clone and start

```powershell
cd $HOME
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
git checkout main

docker compose down
docker compose up -d --build
```

### 6. Open the coach

1. Check Whisper:

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:9000/docs
   ```

2. Open **http://127.0.0.1:4378** in Chrome or Edge.
3. Allow the microphone for this site.
4. For guided listen TTS, install a French voice under **Settings → Time & language → Speech** (or *Accessibility → Narrator* voices, depending on Windows version).

### 7. Optional: Whisper Small

```powershell
docker compose --profile small up -d
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:9001/docs
```

Choose **Small** in the app when the light is green.

### 8. Stop

```powershell
docker compose down
```

### Windows firewall / ports

If the page does not load, allow Docker / local ports **4378**, **9000**, **8000** (and **9001** for Small) for private networks, or temporarily disable firewall only to test.

---

## Linux

### 1. System requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| OS | Ubuntu 22.04+, Fedora 39+, Debian 12+, or similar | Ubuntu 24.04 LTS |
| RAM | 8 GB | 16 GB |
| Disk free | 10 GB | 20 GB+ |
| Docker | Docker Engine + Compose plugin | Latest from Docker’s docs |
| Browser | Chrome, Chromium, or Edge | Latest |
| Audio | PulseAudio/PipeWire + working mic | — |
| Git | Distro package | Latest |

### 2. Install Docker Engine + Compose

Follow the official guide for your distro:  
https://docs.docker.com/engine/install/

Example on **Ubuntu**:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
# then follow Docker’s Ubuntu install steps for the docker-ce packages
sudo usermod -aG docker "$USER"
```

Log out and back in (or reboot) so your user can run Docker without `sudo`.

Verify:

```bash
docker --version
docker compose version
```

### 3. Install Git and a browser

```bash
# Debian/Ubuntu
sudo apt-get install -y git
# Install Google Chrome or use Chromium from your distro
```

### 4. Clone and start

```bash
git clone https://github.com/saket96/french-reading-coach.git
cd french-reading-coach
git checkout main
git pull origin main

docker compose down
docker compose up -d --build
```

### 5. Open the coach

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9000/docs
xdg-open http://127.0.0.1:4378   # or open manually in Chrome/Chromium/Edge
```

Allow microphone permission in the browser. For TTS, ensure a French voice is available to the browser (e.g. `espeak-ng` / system speech, or Chrome’s remote voices with network access).

### 6. Optional: Whisper Small

```bash
docker compose --profile small up -d
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9001/docs
```

### 7. Stop

```bash
docker compose down
```

### Linux tips

- If ports are busy: `sudo ss -tlnp | grep -E '4378|9000|8000|9001'`
- If permission denied on Docker socket: ensure your user is in the `docker` group and you re-logged in.
- Headless servers: this app needs a browser + mic on the machine (or a remote desktop session) where you practice speaking.

---

## Using the coach (after install)

1. Open **http://127.0.0.1:4378** — the reading passage is wide beside the floating **Outils** dock.
2. Choose a **Bibliothèque** text or **Mon texte** (paste keeps your line breaks).
3. In **Outils**:
   - **Voix française** → pick Amélie/Thomas → **Tester la voix**
   - Speed: **Lent / Moyen / Rapide**
   - **Écouter tout** — full passage, word highlight, **auto-scroll** on long texts
   - **Écouter (guidé)** — current step only
   - **Clic** Mot/Phrase — tap to hear + translate
   - **Enregistrer** — needs Whisper green light
4. **Mes travaux** saves custom texts in the browser; **Révision** drills saved vocabulary.

If **Écouter** is silent in Opera/Chrome: install a **local** French voice, pick it in the dock, click **Tester la voix**, then try again. Safari on Mac is usually the most reliable for listen-only.

---

## Verify everything is healthy

```bash
docker compose ps
curl -s -o /dev/null -w "whisper base: %{http_code}\n" http://127.0.0.1:9000/docs
curl -s -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:4378/
curl -s -o /dev/null -w "pronounce: %{http_code}\n" http://127.0.0.1:8000/docs
```

Optional Small:

```bash
curl -s -o /dev/null -w "whisper small: %{http_code}\n" http://127.0.0.1:9001/docs
```

Useful logs:

```bash
docker compose logs -f web
docker compose logs --tail=80 whisper
docker compose logs --tail=80 pronounce
```

---

## Updating to the latest version

```bash
cd french-reading-coach
git checkout main
git pull origin main
docker compose down
docker compose up -d --build
```

If you use Small:

```bash
docker compose --profile small up -d --build
```

---

## Uninstall / free disk space

```bash
cd french-reading-coach
docker compose --profile small down -v
```

`-v` removes Docker volumes (downloaded Whisper / OpenPronounce model caches).  
Then delete the project folder if you no longer need the source.
