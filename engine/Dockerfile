# Debian slim: mediapipe and OpenCV ship glibc wheels. libegl1/libgles2 are
# needed by mediapipe's native bindings at the first detection, not at build.
FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg libgl1 libglib2.0-0 libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-compile -r requirements.txt

# The pose model is baked into the image so the first request never waits on a download.
ARG POSE_MODEL=lite
ENV POSE_MODEL=${POSE_MODEL} POSE_MODEL_PATH=/app/models/pose_landmarker_${POSE_MODEL}.task
RUN mkdir -p /app/models && curl -fsSL -o "$POSE_MODEL_PATH" \
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${POSE_MODEL}/float16/latest/pose_landmarker_${POSE_MODEL}.task"

COPY . .
# Mount a persistent disk at /app/data: it holds the database, uploads and results.
ENV DATA_DIR=/app/data
RUN useradd --create-home --uid 10001 coachai && mkdir -p /app/data && chown -R coachai:coachai /app
USER coachai

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import sys,urllib.request;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health',timeout=3).status==200 else 1)"

# One process: the job queue, SQLite and the webhook sender live in it. Scale with ENGINE_WORKERS or more engines.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--timeout-graceful-shutdown", "30"]
