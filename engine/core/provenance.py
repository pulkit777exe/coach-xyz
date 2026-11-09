"""Reproducibility manifest for one analysis run.

The result already carries engine and sport-pack versions. That is not enough
to reproduce a research run: the exact commit, pack bytes, model file, prompt
text and video content all matter. This module collects those facts without
ever reading secrets.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import os
import platform
import subprocess
import sys
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from . import config


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path, chunk: int = 8 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


@lru_cache(maxsize=1)
def git_commit() -> str | None:
    """The commit that produced this run, from env or the working tree."""
    for name in ("GIT_COMMIT", "SOURCE_COMMIT", "RENDER_GIT_COMMIT"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=config.ROOT,
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _version(dist: str) -> str | None:
    try:
        return importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        return None


@lru_cache(maxsize=1)
def environment() -> dict:
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": {
            "mediapipe": _version("mediapipe"),
            "numpy": _version("numpy"),
            "opencv-python": _version("opencv-python"),
            "pydantic": _version("pydantic"),
            "google-genai": _version("google-genai"),
        },
    }


def prompt_hash(system: str, user: str) -> str:
    return _sha256_bytes((system + "\n---\n" + user).encode("utf-8"))


@lru_cache(maxsize=1)
def prompts_source_hash() -> str | None:
    path = Path(__file__).with_name("prompts.py")
    try:
        return sha256_file(path)
    except OSError:
        return None


def pose_model_manifest() -> dict:
    s = config.settings
    path = (
        Path(s.pose_model_path)
        if s.pose_model_path
        else s.data_dir / "models" / f"pose_landmarker_{s.pose_model}.task"
    )
    return {
        "family": "mediapipe_pose_landmarker",
        "variant": s.pose_model,
        "path": str(path),
        "sha256": sha256_file(path) if path.is_file() else None,
    }


def pack_manifest(pack) -> dict:
    return {
        "name": pack.name,
        "version": pack.version,
        "pack_version": pack.pack_version or None,
        "action_id": pack.action_id or None,
        "path": pack.path or None,
        "sha256": pack.checksum or None,
    }


def video_manifest(media, sha256: str | None) -> dict:
    return {
        "sha256": sha256,
        "duration_s": round(float(media.duration), 3),
        "fps": round(float(media.fps), 3),
        "codec": getattr(media, "codec", "") or None,
        "has_audio": bool(media.has_audio),
    }


def build(
    *,
    pack,
    media,
    video_sha256: str | None,
    judgement,
    angle: str | None,
    angle_source: str,
    pack_changed_after_judge: bool = False,
    preprocessing: dict | None = None,
    research_mode: bool = False,
    detected_angle: str | None = None,
) -> dict:
    """The manifest stored under ``result.provenance.manifest``."""
    phases = [p.get("id") for p in (getattr(pack, "phases", None) or []) if p.get("id")]
    return {
        "manifest_version": 1,
        "phases": phases,
        "application": {
            "engine_version": config.ENGINE_VERSION,
            "pipeline_version": config.PIPELINE_VERSION,
            "git_commit": git_commit(),
        },
        "sport_pack": pack_manifest(pack),
        "models": {
            "pose": pose_model_manifest(),
            "vlm": {
                "provider": "google-genai",
                "configured_models": list(config.settings.gemini_models),
                "model_used": judgement.model,
            },
        },
        "prompt": {
            "version": config.PROMPT_VERSION,
            "hash": judgement.prompt_hash,
            "source_hash": prompts_source_hash(),
        },
        "video": video_manifest(media, video_sha256),
        "camera": {
            "angle": angle,
            "angle_source": angle_source,
            "detected_angle": detected_angle,
            "research_mode": bool(research_mode),
        },
        "preprocessing": preprocessing or {},
        "judgement": {
            "source": judgement.source,
            "judged_at": judgement.judged_at,
            "model": judgement.model,
        },
        "pack_changed_after_judge": bool(pack_changed_after_judge),
        "evaluated_at": datetime.now(UTC).isoformat(),
        "environment": environment(),
    }
