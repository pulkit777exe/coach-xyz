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
    # Pick up trixie-security patches: stale base layers ship known
    # HIGH/CRITICAL OS CVEs that fail the CI image scan.
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# One install, no cache: the ENV above sets PIP_NO_CACHE_DIR=1, which makes
# `pip cache purge` exit 1 and fails the whole build. The self-upgrade is
# dropped too — the base image's pip resolves these pins fine.
RUN pip install --no-cache-dir --no-compile --timeout 100 --retries 5 \
    -r requirements.txt

# The pose model is gitignored (*.task) and nothing fetches it at runtime, so
# without this step every build ships an image where the first analysis dies
# with "model file is missing" — and /health cannot catch it, because it only
# checks that mediapipe imports. Pinned to a versioned asset with a checksum so
# a swapped or truncated download fails the build instead of the deploy.
# urllib is already here; this avoids adding curl to the image.
ARG POSE_MODEL_URL=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
ARG POSE_MODEL_SHA256=5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1
RUN python -c "import urllib.request; urllib.request.urlretrieve('$POSE_MODEL_URL', '/app/pose_landmarker_full.task')" \
    && echo "$POSE_MODEL_SHA256  /app/pose_landmarker_full.task" | sha256sum -c -

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
