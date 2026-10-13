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


def sport_pack_version(sport: str | None) -> int:
    """Version stamp of the sport pack (0 when unknown/unversioned)."""
    config = load_sport_config(sport)
    version = config.get("version")
    return version if isinstance(version, int) and version > 0 else 0


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


def sport_positions(sport: str | None) -> list[dict[str, str]]:
    """Canonical position vocabulary for a sport from the sport config.

    Returns [{id, label, description}] — [] when the sport has no vocabulary.
    Malformed entries are skipped so a bad JSON file degrades to no vocabulary
    instead of breaking roster flows.
    """
    config = load_sport_config(sport)
    raw = config.get("positions")
    if not isinstance(raw, list):
        return []
    positions: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        position_id = entry.get("id")
        label = entry.get("label")
        if not isinstance(position_id, str) or not position_id.strip():
            continue
        if not isinstance(label, str) or not label.strip():
            continue
        description = entry.get("description")
        positions.append({
            "id": position_id.strip(),
            "label": label.strip(),
            "description": description.strip() if isinstance(description, str) else "",
        })
    return positions


def _str_list(value: Any) -> list[str]:
    """String list from a pack node (non-strings dropped, fail-open)."""
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, str) and v]


def sport_outcomes(sport: str | None) -> dict[str, list[str]]:
    """Outcome vocabulary for a sport from its pack.

    Returns {positive, negative, neutral} outcome keys — each [] when the
    pack lacks the section. Neutral outcomes (walk, in_play, saves) are
    valid results that count as neither made nor missed.
    """
    config = load_sport_config(sport)
    raw = config.get("events")
    events = raw if isinstance(raw, dict) else {}
    return {
        "positive": _str_list(events.get("positive")),
        "negative": _str_list(events.get("negative")),
        "neutral": _str_list(events.get("neutral")),
    }


def sport_stat_keys(sport: str | None) -> list[str]:
    """Stat keys for a sport from its pack (`stats[].key`, in pack order)."""
    config = load_sport_config(sport)
    raw = config.get("stats")
    if not isinstance(raw, list):
        return []
    keys: list[str] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        if isinstance(key, str) and key:
            keys.append(key)
    return keys
