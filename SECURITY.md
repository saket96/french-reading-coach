# Security and privacy

## Local-first design

- Microphone audio is sent to **services running on your machine** (Docker: Whisper ASR, OpenPronounce).
- Vocabulary and review progress are stored in the **browser** (`localStorage`), not on a remote app server.
- This project does not require an account.

## Network use

With a normal install, the browser may contact:

- **MyMemory** / **Reverso** (or similar) for word glosses and example links when you look up vocabulary
- **Google Fonts** (loaded by the web UI)
- **gTTS** / Hugging Face model downloads **inside Docker** on first pronunciation setup (OpenPronounce container)

Do not expose ports `4378`, `9000`, `8000`, or `9001` to the public internet without authentication and hardening. The default setup is for **localhost** practice only.

## Reporting vulnerabilities

Please open a private security advisory on GitHub if available, or contact the author at  
**[https://saketsuman.com/contact/](https://saketsuman.com/contact/)**.  
Do not file public issues that include exploit details until a fix can be prepared.
