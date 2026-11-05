"""Evidence vocabulary shared by measurement, judgement and result serialization.

The research protocol keeps four independent axes. They must not be collapsed
into a single ``source`` field:

- ``evidence_type``: the criterion's role in the rubric
  (measured / conditional / judged / excluded).
- ``source``: where the evidence came from
  (pose / object_tracking / vlm / rule / human_reference).
- ``state``: whether the evidence can support a claim
  (valid / low_confidence / invalid_view / occluded / unavailable /
  not_applicable).
- ``validation_status``: the criterion's research lifecycle
  (proposed / coach_reviewed / measurement_tested / coach_validated /
  production_approved).

A VLM observation can be a valid observation while a pose measurement from an
unsuitable camera is invalid. Keeping the axes separate makes that distinction
visible in the result JSON and in the exports.
"""

from __future__ import annotations

from typing import Literal

EvidenceType = Literal["measured", "conditional", "judged", "excluded"]
EvidenceSource = Literal["pose", "object_tracking", "vlm", "rule", "human_reference"]
EvidenceState = Literal[
    "valid",
    "low_confidence",
    "invalid_view",
    "occluded",
    "unavailable",
    "not_applicable",
]
ValidationStatus = Literal[
    "proposed",
    "coach_reviewed",
    "measurement_tested",
    "coach_validated",
    "production_approved",
]
MeasurementType = Literal[
    "image_plane_angle",
    "image_plane_distance",
    "normalized_ratio",
    "count",
    "qualitative",
    "none",
]
Calibration = Literal[
    "uncalibrated_2d",
    "calibrated_2d",
    "calibrated_metric_3d",
    "reference_3d",
    "not_applicable",
]

EVIDENCE_TYPES: tuple[str, ...] = ("measured", "conditional", "judged", "excluded")
SOURCES: tuple[str, ...] = ("pose", "object_tracking", "vlm", "rule", "human_reference")
STATES: tuple[str, ...] = (
    "valid",
    "low_confidence",
    "invalid_view",
    "occluded",
    "unavailable",
    "not_applicable",
)
VALIDATION_STATUSES: tuple[str, ...] = (
    "proposed",
    "coach_reviewed",
    "measurement_tested",
    "coach_validated",
    "production_approved",
)

# Sources that can support a numeric measurement. ``rule`` and ``vlm`` are
# deliberately excluded: a rule can confirm an event, and a VLM can provide a
# qualitative observation, but neither is a measured joint quantity.
MEASURED_SOURCES = frozenset({"pose", "object_tracking", "human_reference"})

SOURCE_CLASS = {
    "pose": "measurement",
    "object_tracking": "measurement",
    "human_reference": "measurement",
    "vlm": "judgement",
    "rule": "rule",
}


def evidence_class(source: str | None) -> str | None:
    """Coarse class used by consumers that need measurement vs judgement."""
    return SOURCE_CLASS.get(source or "")


def is_measurement(source: str | None) -> bool:
    return source in MEASURED_SOURCES


def is_scorable(source: str | None, state: str | None) -> bool:
    """Only a valid measurement may contribute to a measured assessment."""
    return source in MEASURED_SOURCES and state == "valid"


def normalise_source(source: str | None) -> str | None:
    """Map legacy result values onto the evidence-source vocabulary."""
    if source in (None, "", "none"):
        return None
    if source == "judged":
        return "vlm"
    if source in SOURCES:
        return source
    return source


def state_for_missing(*, angle_ok: bool = True, landmarks_ok: bool = True,
                      low_confidence: bool = False, applicable: bool = True) -> str:
    """Pick the most specific missing-evidence state."""
    if not applicable:
        return "not_applicable"
    if not angle_ok:
        return "invalid_view"
    if not landmarks_ok:
        return "occluded"
    if low_confidence:
        return "low_confidence"
    return "unavailable"


def as_record(*, criterion_id: str, source: str | None, state: str, evidence_type: str,
              validation_status: str, measurement_type: str, calibration: str,
              value: float | None = None, unit: str = "", confidence: float | None = None,
              source_frames: list[int] | None = None, note: str = "") -> dict:
    """Build one evidence record with all four axes present.

    ``source`` is ``None`` when no source produced a value; ``state`` still
    explains why. This is intentionally different from the old ``source: none``
    sentinel, which conflated "no source" with "unavailable".
    """
    return {
        "criterion_id": criterion_id,
        "source": source,
        "state": state,
        "evidence_type": evidence_type,
        "validation_status": validation_status,
        "measurement_type": measurement_type,
        "calibration": calibration,
        "value": value,
        "unit": unit,
        "confidence": confidence,
        "confidence_kind": "landmark_visibility" if confidence is not None else None,
        "source_frames": source_frames or [],
        "note": note,
    }
