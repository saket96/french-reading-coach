"""Thin FastAPI wrapper around OpenPronounce for French reading practice.

Uses offline Piper TTS by default (gTTS is flaky — needs Google and often
fails intermittently in browsers like Opera). Warms French models on startup
and falls back to transcription-only scoring if full acoustic compare fails.
"""

from __future__ import annotations

import logging
import math
import subprocess
import tempfile
import threading
import traceback
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("pronounce")

app = FastAPI(title="French pronunciation coach", version="1.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Long passages thrash CPU for minutes; score the opening stretch instead.
MAX_EXPECTED_CHARS = 420

_ready = {
    "openpronounce": False,
    "fr_ready": False,
    "warming": False,
    "tts": "",
    "last_error": "",
}


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


def _load_sound_from_upload(raw: bytes, suffix: str):
    from openpronounce import load_audio

    with tempfile.TemporaryDirectory() as tmpdir:
        src = Path(tmpdir) / f"input{suffix}"
        wav = Path(tmpdir) / "input.wav"
        src.write_bytes(raw)
        try:
            _ffmpeg_to_wav(src, wav)
            return load_audio(str(wav))
        except Exception as convert_exc:
            log.warning("ffmpeg convert failed (%s); trying original", convert_exc)
            try:
                return load_audio(str(src))
            except Exception as load_exc:
                raise RuntimeError(
                    "Audio illisible (WebM Opera incomplet ?). "
                    f"ffmpeg: {convert_exc}; load: {load_exc}"
                ) from load_exc


def _score_from_differences(differences: dict) -> float:
    """0–100 score when we cannot run the full acoustic + TTS path."""
    phoneme_er = float(differences.get("phoneme_error_rate") or 0)
    word_er = float(differences.get("word_error_rate") or 0)
    phone = max(0.0, min(1.0, 1.0 - phoneme_er))
    words = max(0.0, min(1.0, 1.0 - word_er))
    return round(100.0 * (0.55 * phone + 0.45 * words), 2)


def _truncate_expected(text: str, max_chars: int = MAX_EXPECTED_CHARS) -> str:
    raw = " ".join(str(text or "").split())
    if len(raw) <= max_chars:
        return raw
    cut = raw[:max_chars]
    # Prefer ending on a sentence boundary when possible
    for sep in (". ", "! ", "? ", "… "):
        idx = cut.rfind(sep)
        if idx >= max_chars // 3:
            return cut[: idx + 1].strip()
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 40 else cut).strip()


def _json_safe(value):
    """Convert numpy / nested OpenPronounce payloads into plain JSON types."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    # numpy scalar (has .item())
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _json_safe(item())
        except Exception:
            return str(value)
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    # numpy arrays / other sequences
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        try:
            return _json_safe(tolist())
        except Exception:
            pass
    return str(value)


def _fallback_transcription_score(sound, expected_text: str, lang: str) -> dict:
    """Score without TTS reference (works offline when gTTS/Piper fails)."""
    from openpronounce import compare_transcriptions, transcribe
    from openpronounce import phones as op_phones

    transcription = transcribe(sound, lang=lang)
    differences = compare_transcriptions(transcription, expected_text, lang=lang)

    try:
        if op_phones.is_enabled():
            recognition = op_phones.recognize_phones(sound, 16000, lang=lang)
            phone_result = op_phones.compare_phones(recognition, expected_text, lang)
            differences.update(
                {
                    "errors": phone_result["errors"],
                    "words_with_errors": phone_result["words_with_errors"],
                    "phoneme_error_rate": phone_result["phone_error_rate"],
                    "expected_phones": phone_result.get("expected_phones"),
                    "heard_phones": phone_result.get("heard_phones"),
                    "feedback": differences.get("feedback")
                    or phone_result.get("feedback"),
                }
            )
    except Exception:
        log.warning("phone-model fallback failed; using transcription compare", exc_info=True)

    return {
        "score": _score_from_differences(differences),
        "differences": differences,
        "transcribe": transcription,
        "language": lang,
        "mode": "transcription-only",
        "note": "Score sans référence TTS (chemin de secours).",
    }


def _warmup_french() -> None:
    """Download FR ASR + Piper voice and prove a short compare works."""
    _ready["warming"] = True
    _ready["last_error"] = ""
    try:
        from openpronounce import compare_audio_with_text, load_audio, text2speech

        # Force TTS + FR ASR download with a tiny phrase.
        sentence = "Bonjour."
        ref = text2speech(sentence, lang="fr")
        sound = load_audio(ref)
        compare_audio_with_text(sound, sentence, lang="fr")
        _ready["fr_ready"] = True
        _ready["last_error"] = ""
        log.info("French OpenPronounce warmup OK (TTS=%s)", _ready["tts"])
    except Exception as exc:
        _ready["fr_ready"] = False
        _ready["last_error"] = str(exc)
        log.exception("French warmup failed — transcription-only fallback still available")
    finally:
        _ready["warming"] = False


@app.on_event("startup")
def startup() -> None:
    import os

    _ready["tts"] = os.environ.get("OPENPRONOUNCE_TTS", "piper")
    try:
        import openpronounce  # noqa: F401

        _ready["openpronounce"] = True
        _ready["last_error"] = ""
        log.info("openpronounce import OK; TTS backend=%s", _ready["tts"])
    except Exception as exc:  # pragma: no cover
        _ready["openpronounce"] = False
        _ready["last_error"] = str(exc)
        log.exception("openpronounce import failed")
        return

    # Warm in background so /health answers immediately while models download.
    thread = threading.Thread(target=_warmup_french, name="fr-warmup", daemon=True)
    thread.start()


@app.get("/health")
def health():
    if not _ready["openpronounce"]:
        status = "degraded"
    elif _ready["warming"]:
        status = "warming"
    elif _ready["fr_ready"]:
        status = "ok"
    else:
        # Import OK but warmup failed — transcription fallback still usable
        status = "degraded"
    return {
        "status": status,
        "lang": "fr",
        "openpronounce": _ready["openpronounce"],
        "fr_ready": _ready["fr_ready"],
        "warming": _ready["warming"],
        "tts": _ready["tts"],
        "last_error": _ready["last_error"],
    }


@app.post("/pronunciation")
async def pronunciation(
    file: UploadFile = File(...),
    expected_text: str = Form(...),
    lang: str = Form("fr"),
):
    expected = _truncate_expected(expected_text)
    if not expected:
        raise HTTPException(status_code=400, detail="expected_text vide")

    try:
        from openpronounce import compare_audio_with_text
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"OpenPronounce non importable: {exc}",
        ) from exc

    filename = file.filename or "audio.webm"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".webm", ".ogg", ".wav", ".mp3", ".m4a", ".mp4", ".opus"}:
        suffix = ".webm"
    raw = await file.read()
    log.info(
        "POST /pronunciation filename=%s bytes=%s expected_chars=%s lang=%s",
        filename,
        len(raw or b""),
        len(expected),
        lang,
    )
    if not raw or len(raw) < 200:
        raise HTTPException(
            status_code=400,
            detail="fichier audio vide ou trop court (réessayez l’enregistrement, surtout sous Opera)",
        )

    lang = (lang or "fr").strip() or "fr"

    try:
        sound = _load_sound_from_upload(raw, suffix)
    except Exception as exc:
        log.error("audio load failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Prefer full acoustic + TTS path; fall back if TTS/network/model flakes.
    try:
        result = compare_audio_with_text(sound, expected, lang=lang)
        if isinstance(result, dict):
            result.setdefault("mode", "full")
            if len(expected_text.strip()) > len(expected):
                result["expected_truncated"] = True
                result["expected_used"] = expected
        _ready["openpronounce"] = True
        _ready["fr_ready"] = True
        _ready["last_error"] = ""
        safe = _json_safe(result)
        log.info("pronunciation OK mode=%s score=%s", safe.get("mode"), safe.get("score"))
        return JSONResponse(content=safe)
    except Exception as full_exc:
        log.warning("full compare failed (%s); trying transcription-only", full_exc, exc_info=True)
        _ready["last_error"] = str(full_exc)
        try:
            result = _fallback_transcription_score(sound, expected, lang)
            if len(expected_text.strip()) > len(expected):
                result["expected_truncated"] = True
                result["expected_used"] = expected
            _ready["openpronounce"] = True
            safe = _json_safe(result)
            log.info(
                "pronunciation fallback OK mode=%s score=%s",
                safe.get("mode"),
                safe.get("score"),
            )
            return JSONResponse(content=safe)
        except Exception as fallback_exc:
            _ready["last_error"] = str(fallback_exc)
            log.error(
                "pronunciation failed: full=%s fallback=%s\n%s",
                full_exc,
                fallback_exc,
                traceback.format_exc(),
            )
            raise HTTPException(
                status_code=500,
                detail=(
                    "Échec OpenPronounce (FR). "
                    "Si le voyant est jaune, le modèle/Piper télécharge encore — attendez. "
                    f"Détail: {fallback_exc}"
                ),
            ) from fallback_exc


@app.post("/phonemes")
async def phonemes(text: str = Form(...), lang: str = Form("fr")):
    try:
        from openpronounce import get_phonemes

        phones = get_phonemes(text, lang=lang or "fr")
        return {"phonemes": phones, "text": text, "lang": lang}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
