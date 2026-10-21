FROM python:3.11-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        espeak-ng \
        libsndfile1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt

# CPU torch first (smaller), then OpenPronounce + API deps
RUN pip install --no-cache-dir \
      torch \
      --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/requirements.txt

COPY server.py /app/server.py

ENV OPENPRONOUNCE_DEVICE=cpu
# Piper is offline after first voice download — gTTS needs Google and fails intermittently.
ENV OPENPRONOUNCE_TTS=piper
ENV OPENPRONOUNCE_TTS_VOICE=fr_FR-siwis-medium
ENV HF_HOME=/models
VOLUME ["/models"]

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
