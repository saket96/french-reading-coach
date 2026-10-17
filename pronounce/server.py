"""Thin FastAPI wrapper around OpenPronounce for French reading practice."""

from __future__ import annotations

import logging
import subprocess
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("pronounce")

app = FastAPI(title="French pronunciation coach", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ready = {"openpronounce": False, "last_error": ""}


def _ffmpeg_to_wav(src: Path, dest: Path) -> None:
    """Normalize browser WebM/Opus (and other formats) to 16 kHz mono WAV."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(
            "ffmpeg n’a pas pu convertir l’audio. "
            + (proc.stderr or proc.stdout or "")[-500:]
        )


@app.on_event("startup")
def startup() -> None:
    try:
        import openpronounce  # noqa: F401

        _ready["openpronounce"] = True
        _ready["last_error"] = ""
        log.info("openpronounce import OK")
    except Exception as exc:  # pragma: no cover
        _ready["openpronounce"] = False
        _ready["last_error"] = str(exc)
        log.exception("openpronounce import failed")


@app.get("/health")
def health():
    return {
        "status": "ok" if _ready["openpronounce"] else "degraded",
        "lang": "fr",
        "openpronounce": _ready["openpronounce"],
        "last_error": _ready["last_error"],
    }


@app.post("/pronunciation")
async def pronunciation(
    file: UploadFile = File(...),
    expected_text: str = Form(...),
    lang: str = Form("fr"),
):
    if not expected_text.strip():
        raise HTTPException(status_code=400, detail="expected_text vide")

    try:
        from openpronounce import compare_audio_with_text, load_audio
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"OpenPronounce non importable: {exc}",
        ) from exc

    filename = file.filename or "audio.webm"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".webm", ".ogg", ".wav", ".mp3", ".m4a", ".mp4", ".opus"}:
        # Opera sometimes sends octet-stream / odd names — assume WebM/Opus
        suffix = ".webm"
    raw = await file.read()
    if not raw or len(raw) < 200:
        raise HTTPException(
            status_code=400,
            detail="fichier audio vide ou trop court (réessayez l’enregistrement, surtout sous Opera)",
        )

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            src = Path(tmpdir) / f"input{suffix}"
            wav = Path(tmpdir) / "input.wav"
            src.write_bytes(raw)
            convert_error = None
            try:
                _ffmpeg_to_wav(src, wav)
                sound = load_audio(str(wav))
            except Exception as convert_exc:
                convert_error = convert_exc
                # Fall back to original bytes if ffmpeg conversion fails
                log.warning(
                    "ffmpeg convert failed (%s); trying original upload",
                    convert_exc,
                    exc_info=True,
                )
                try:
                    sound = load_audio(str(src))
                except Exception as load_exc:
                    raise RuntimeError(
                        "Audio illisible (WebM Opera incomplet ?). "
                        f"ffmpeg: {convert_error}; load: {load_exc}"
                    ) from load_exc

            result = compare_audio_with_text(sound, expected_text, lang=lang or "fr")
        _ready["openpronounce"] = True
        _ready["last_error"] = ""
        return result
    except Exception as exc:
        _ready["last_error"] = str(exc)
        log.error("pronunciation failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=(
                "Échec OpenPronounce (FR expérimental). "
                "Au premier essai le modèle FR (~1.2 Go) se télécharge — "
                "attendez le voyant Prononciation, cliquez Reset, puis réessayez. Détail: "
                f"{exc}"
            ),
        ) from exc


@app.post("/phonemes")
async def phonemes(text: str = Form(...), lang: str = Form("fr")):
    try:
        from openpronounce import get_phonemes

        phones = get_phonemes(text, lang=lang or "fr")
        return {"phonemes": phones, "text": text, "lang": lang}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
