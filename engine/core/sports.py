"""Sport packs: what to look for, what counts as a good result, which ranges are ideal.

Packs are JSON files in `sports/`. Older packs that use `form_criteria` /
`ideal_range` / `events` are read as well.
"""

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache

from .config import ROOT

SPORTS_DIR = ROOT / "sports"
SLUG = re.compile(r"^[a-z0-9_]+$")
KNOWN = ("basketball", "football", "cricket", "tennis", "baseball", "hockey")


@dataclass
class Criterion:
    key: str
    label: str
    metric: str
    ideal: tuple[float, float] | None
    acceptable: tuple[float, float] | None
    weight: float
    look_for: str = ""
    drill: str = ""
    valid_angles: tuple[str, ...] | None = None  # camera angles this measurement is valid from; None = any


@dataclass
class Pack:
    name: str
    version: int
    label: str
    signal: str
    min_gap_s: float
    floor: float
    event_types: list[str]
    positive: list[str]
    negative: list[str]
    neutral: list[str]
    criteria: list[Criterion]
    positions: list[dict]
    camera_angles: list[dict]
    display_s: float = 2.5
    coaching_note: str = ""
    colors: dict = field(default_factory=dict)

    @property
    def results(self) -> list[str]:
        return [*self.positive, *self.negative, *self.neutral]


def _range(value) -> tuple[float, float] | None:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return float(value[0]), float(value[1])
    return None


def _criterion(raw: dict) -> Criterion:
    return Criterion(
        key=raw["key"],
        label=raw.get("label", raw["key"]),
        metric=raw.get("metric", ""),
        ideal=_range(raw.get("ideal", raw.get("ideal_range"))),
        acceptable=_range(raw.get("acceptable", raw.get("acceptable_range"))),
        weight=float(raw.get("weight", 0) or 0),
        look_for=raw.get("look_for", ""),
        drill=raw.get("drill", ""),
        valid_angles=tuple(raw["valid_angles"]) if raw.get("valid_angles") else None,
    )


@lru_cache(maxsize=32)
def load(name: str | None) -> Pack:
    name = (name or "generic").lower()
    path = SPORTS_DIR / f"{name}.json"
    if not SLUG.match(name) or not path.is_file():
        name, path = "generic", SPORTS_DIR / "generic.json"
    raw = json.loads(path.read_text())
    action = raw.get("action", {})
    results = raw.get("results") or raw.get("events") or {}
    return Pack(
        name=name,
        version=int(raw.get("version", 1)),
        label=raw.get("label", name.title()),
        signal=action.get("signal", "wrist_speed"),
        min_gap_s=float(action.get("min_gap_s", 1.5)),
        floor=float(action.get("floor", 4.0)),
        event_types=raw.get("event_types") or ["action"],
        positive=list(results.get("positive", [])),
        negative=list(results.get("negative", [])),
        neutral=list(results.get("neutral", ["unknown"])),
        criteria=[_criterion(c) for c in raw.get("criteria") or raw.get("form_criteria") or [] if "key" in c],
        positions=raw.get("positions", []),
        camera_angles=raw.get("camera_angles", []),
        display_s=float(raw.get("display_s", raw.get("feedback_display_seconds", 2.5))),
        coaching_note=raw.get("coaching_note", ""),
        colors=raw.get("colors", {}),
    )
