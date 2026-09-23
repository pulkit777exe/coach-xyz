"""core/sport_config.py — single loader for sports/*.json scoring configs.

Previously `analyzer.py` and `renderer.py` each carried their own file-reading
copy. One cached loader here; both consumers import it. Also the canonical
home of the sport list + emoji map (SPORTS / SPORT_EMOJIS).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CONFIG_CACHE: dict[str, dict[str, Any]] = {}


def _sports_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent / "sports"


def _config_path(sport: str) -> Path:
    return _sports_dir() / f"{sport.lower()}.json"


# ── Canonical sport vocabulary ───────────────────────────────────────────────
# Single source of truth for the sport list and its display emoji. The ids
# mirror the sports/*.json packs loaded above (checked by sport_pack_ids());
# the order is the presentation order baked into prompt text and UI copy, so
# it is declared once here instead of per consumer (prompt.py, validator.py,
# cli/main.py all import it).

SPORTS: tuple[str, ...] = (
    "basketball",
    "football",
    "cricket",
    "tennis",
    "baseball",
    "hockey",
)

SPORT_EMOJIS: dict[str, str] = {
    "basketball": "🏀",
    "football": "⚽",
    "cricket": "🏏",
    "tennis": "🎾",
    "baseball": "⚾",
    "hockey": "🏒",
}

SPORT_EMOJI_FALLBACK = "🎯"


def sport_pack_ids() -> list[str]:
    """Sport ids derived from the sports/*.json packs on disk (sorted)."""
    return sorted(path.stem for path in _sports_dir().glob("*.json") if path.is_file())


def sport_emoji(sport: str | None) -> str:
    """Display emoji for a sport (fallback 🎯 for unknown/None)."""
    return SPORT_EMOJIS.get((sport or "").lower(), SPORT_EMOJI_FALLBACK)


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
