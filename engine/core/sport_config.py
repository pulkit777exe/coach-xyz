"""core/sport_config.py — single loader for sports/*.json scoring configs.

Previously `analyzer.py` and `renderer.py` each carried their own file-reading
copy. One cached loader here; both consumers import it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CONFIG_CACHE: dict[str, dict[str, Any]] = {}


def _config_path(sport: str) -> Path:
    return Path(__file__).resolve().parent.parent.parent / "sports" / f"{sport.lower()}.json"


def load_sport_config(sport: str | None) -> dict[str, Any]:
    """Load and cache the scoring config for a sport ({} when unknown)."""
    key = (sport or "").lower()
    if key in _CONFIG_CACHE:
        return _CONFIG_CACHE[key]
    try:
        with open(_config_path(key), "r") as f:
            config = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        config = {}
    if not isinstance(config, dict):
        config = {}
    _CONFIG_CACHE[key] = config
    return config


def recommended_camera_angles(sport: str | None) -> list[dict[str, str]]:
    """Coach-facing camera guidance from the sport config.

    Returns [{id, label, description}] — [] when the sport has no guidance.
    Malformed entries are skipped so a bad JSON file degrades to no guidance
    instead of breaking the analysis response.
    """
    config = load_sport_config(sport)
    raw = config.get("camera_angles")
    if not isinstance(raw, list):
        return []
    guidance: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        angle_id = entry.get("id")
        label = entry.get("label")
        if not isinstance(angle_id, str) or not angle_id.strip():
            continue
        if not isinstance(label, str) or not label.strip():
            continue
        description = entry.get("description")
        guidance.append({
            "id": angle_id.strip(),
            "label": label.strip(),
            "description": description.strip() if isinstance(description, str) else "",
        })
    return guidance
