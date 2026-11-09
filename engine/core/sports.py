"""Sport packs: what to look for, what counts as a good result, which ranges are ideal.

Packs are JSON files in `sports/`. Older packs that use `form_criteria` /
`ideal_range` / `events` are read as well.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache

from .config import ROOT
from .evidence import EVIDENCE_TYPES, VALIDATION_STATUSES

SPORTS_DIR = ROOT / "sports"
SLUG = re.compile(r"^[a-z0-9_]+$")
KNOWN = ("basketball", "football", "cricket", "tennis", "baseball", "hockey")


DEFAULT_ABSTENTION_STATES: tuple[str, ...] = (
    "unable_to_assess",
    "not_applicable",
    "invalid_view",
    "occluded",
    "unavailable",
)


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
    valid_angles: tuple[str, ...] | None = None  # legacy name; use allowed_views
    criterion_id: str | None = None  # paper identifier (CR01, FB04, BB09, ...)
    evidence_type: str = "measured"  # measured | conditional | judged | excluded
    validation_status: str = "proposed"  # proposed | coach_reviewed | ...
    measurement_type: str = "image_plane_angle"
    calibration: str = "uncalibrated_2d"
    allowed_views: tuple[str, ...] | None = (
        None  # camera views this measurement is valid from
    )
    phase_scope: tuple[
        str, ...
    ] = ()  # paper phase identifiers this criterion belongs to
    required_landmarks: tuple[str, ...] = ()
    required_objects: tuple[str, ...] = ()
    quality_gate: str = ""
    supporting_references: tuple[str, ...] = ()
    implementation_note: str = ""
    abstention_states: tuple[str, ...] = DEFAULT_ABSTENTION_STATES


@dataclass
class MetricDef:
    """A sport-specific performance number that is shown, not scored.

    Criteria answer "is this joint in the target range". Key metrics answer
    "how fast / how high / how balanced was the athlete" and are derived from
    the whole track, so they read the same regardless of camera distance.
    """

    key: str
    label: str
    metric: str
    unit: str = ""
    ideal: tuple[float, float] | None = None
    acceptable: tuple[float, float] | None = None


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
    key_metrics: list[MetricDef] = field(default_factory=list)
    roles: dict = field(default_factory=dict)
    display_s: float = 2.5
    coaching_note: str = ""
    colors: dict = field(default_factory=dict)
    action_id: str = ""
    pack_version: str = ""
    checksum: str = ""
    path: str = ""
    paper_criteria: list[dict] = field(default_factory=list)
    phases: list[dict] = field(default_factory=list)
    objects: list[dict] = field(default_factory=list)
    scope_note: str = ""
    aggregation: str = "disabled_until_validated"
    fallback: dict = field(default_factory=dict)

    @property
    def results(self) -> list[str]:
        return [*self.positive, *self.negative, *self.neutral]

    @property
    def primary_role(self) -> str:
        return self.roles.get("primary", "Athlete")

    @property
    def opponent_role(self) -> str:
        return self.roles.get("opponent", "Nearest player")


def _range(value) -> tuple[float, float] | None:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return float(value[0]), float(value[1])
    return None


def _criterion(raw: dict) -> Criterion:
    evidence_type = str(raw.get("evidence_type") or "measured")
    validation_status = str(raw.get("validation_status") or "proposed")
    allowed = raw.get("allowed_views") or raw.get("valid_angles")
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
        criterion_id=raw.get("criterion_id") or raw.get("id"),
        evidence_type=evidence_type if evidence_type in EVIDENCE_TYPES else "measured",
        validation_status=validation_status
        if validation_status in VALIDATION_STATUSES
        else "proposed",
        measurement_type=str(raw.get("measurement_type") or "image_plane_angle"),
        calibration=str(raw.get("calibration") or "uncalibrated_2d"),
        allowed_views=tuple(allowed) if allowed else None,
        phase_scope=tuple(raw.get("phase_scope") or ()),
        required_landmarks=tuple(raw.get("required_landmarks") or ()),
        required_objects=tuple(raw.get("required_objects") or ()),
        quality_gate=str(raw.get("quality_gate") or ""),
        supporting_references=tuple(raw.get("supporting_references") or ()),
        implementation_note=str(raw.get("implementation_note") or ""),
        abstention_states=tuple(
            raw.get("abstention_states") or DEFAULT_ABSTENTION_STATES
        ),
    )


def _metric(raw: dict) -> MetricDef:
    return MetricDef(
        key=raw["key"],
        label=raw.get("label", raw["key"]),
        metric=raw.get("metric", raw["key"]),
        unit=raw.get("unit", ""),
        ideal=_range(raw.get("ideal", raw.get("ideal_range"))),
        acceptable=_range(raw.get("acceptable", raw.get("acceptable_range"))),
    )


@lru_cache(maxsize=32)
def load(name: str | None) -> Pack:
    name = (name or "generic").lower()
    path = SPORTS_DIR / f"{name}.json"
    if not SLUG.match(name) or not path.is_file():
        name, path = "generic", SPORTS_DIR / "generic.json"
    raw_bytes = path.read_bytes()
    raw = json.loads(raw_bytes)
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
        criteria=[
            _criterion(c)
            for c in raw.get("criteria") or raw.get("form_criteria") or []
            if "key" in c
        ],
        positions=raw.get("positions", []),
        camera_angles=raw.get("camera_angles", []),
        key_metrics=[_metric(m) for m in raw.get("key_metrics") or [] if "key" in m],
        roles=raw.get("roles", {}),
        display_s=float(raw.get("display_s", raw.get("feedback_display_seconds", 2.5))),
        coaching_note=raw.get("coaching_note", ""),
        colors=raw.get("colors", {}),
        action_id=str(action.get("id") or raw.get("action_id") or ""),
        pack_version=str(raw.get("pack_version") or ""),
        checksum=hashlib.sha256(raw_bytes).hexdigest(),
        path=str(path),
        paper_criteria=list(raw.get("paper_criteria") or []),
        phases=list(raw.get("phases") or []),
        objects=list(raw.get("objects") or []),
        scope_note=str(raw.get("scope_note") or ""),
        aggregation=str(raw.get("aggregation") or "disabled_until_validated"),
        fallback=dict(raw.get("fallback") or {}),
    )
