# Debian slim keeps the runtime compatible with ffmpeg, OpenCV, and MediaPipe;
# Alpine is not used because their native wheels/libraries expect glibc.
# libegl1/libgles2 are MediaPipe 1.0.1's native bindings: without them
# PoseLandmarker.create_from_options dies with "libEGL.so.1: cannot open
# shared object file" at the first analysis, not at build time.
FROM python:3.12.14-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=100

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        libegl1 \
        libgles2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# One install, no cache: the ENV above sets PIP_NO_CACHE_DIR=1, which makes
# `pip cache purge` exit 1 and fails the whole build. The self-upgrade is
# dropped too — the base image's pip resolves these pins fine.
RUN pip install --no-cache-dir --no-compile --timeout 100 --retries 5 \
    -r requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 coachai \
    && mkdir -p /app/tmp \
    && chown -R coachai:coachai /app

USER coachai

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import sys,urllib.request;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health',timeout=3).status==200 else 1)"

# Single worker for 512MB RAM limit on free tier
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
