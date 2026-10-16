"""Thin FastAPI wrapper around OpenPronounce for French reading practice."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="French pronunciation coach", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "lang": "fr"}


@app.post("/pronunciation")
async def pronunciation(
    file: UploadFile = File(...),
    expected_text: str = Form(...),
    lang: str = Form("fr"),
):
    from openpronounce import compare_audio_with_text, load_audio

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        sound = load_audio(tmp.name)
        result = compare_audio_with_text(sound, expected_text, lang=lang or "fr")
    return result


@app.post("/phonemes")
async def phonemes(text: str = Form(...), lang: str = Form("fr")):
    from openpronounce import get_phonemes

    phones = get_phonemes(text, lang=lang or "fr")
    return {"phonemes": phones, "text": text, "lang": lang}
