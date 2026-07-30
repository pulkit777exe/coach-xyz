from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Optional

from upstash_redis import Redis as UpstashRedis

_redis: Optional[UpstashRedis] = None


def _get_redis() -> Optional[UpstashRedis]:
    global _redis
    if _redis is not None:
        return _redis
    url = os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if url and token:
        _redis = UpstashRedis(url=url, token=token)
    return _redis


CACHE_TTL = 3600 * 24  # 24 hours
CACHE_PREFIX = "coachai:analysis:"


def compute_video_hash(video_path: str) -> str:
    """
    Fast hash for cache key using file size + first/last 1MB.
    Full content hash is slow for large videos.
    """
    size = os.path.getsize(video_path)
    chunk_size = 1024 * 1024

    with open(video_path, "rb") as f:
        first_chunk = f.read(chunk_size)
        if size > chunk_size * 2:
            f.seek(-chunk_size, 2)
            last_chunk = f.read(chunk_size)
        else:
            last_chunk = b""

    hasher = hashlib.sha256()
    hasher.update(str(size).encode())
    hasher.update(first_chunk)
    hasher.update(last_chunk)
    return hasher.hexdigest()[:16]


def get_cached_analysis(video_hash: str, player_index: int | None = None) -> Optional[dict]:
    """Check Redis cache for a previous analysis result."""
    r = _get_redis()
    if r is None:
        return None
    key = f"{CACHE_PREFIX}{video_hash}:p{player_index if player_index is not None else 'all'}"
    cached = r.get(key)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            return None
    return None


def set_cached_analysis(video_hash: str, result: dict, player_index: int | None = None) -> None:
    """Store analysis result in Redis cache."""
    r = _get_redis()
    if r is None:
        return
    key = f"{CACHE_PREFIX}{video_hash}:p{player_index if player_index is not None else 'all'}"
    r.set(key, json.dumps(result, default=str), ex=CACHE_TTL)


def warm_cache_for_video(video_hash: str, video_path: str) -> None:
    """
    Pre-warm cache by computing video hash and storing metadata.
    Call this on upload to make subsequent analyses faster.
    """
    r = _get_redis()
    if r is None:
        return

    # Store video metadata for cache warming prioritization
    # Note: video_path is NOT stored here because temp files are deleted after scan.
    # The hash itself is the cache key; analysis results are stored separately.
    metadata_key = f"{CACHE_PREFIX}{video_hash}:metadata"
    metadata = {
        "cached_at": time.time(),
        "access_count": 0,
    }
    r.set(metadata_key, json.dumps(metadata), ex=CACHE_TTL)
