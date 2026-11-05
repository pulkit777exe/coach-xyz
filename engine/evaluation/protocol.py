"""Offline evaluation protocol for the research manuscript.

This module is deliberately separate from ``pipeline.run()``. The runtime engine
produces evidence; the evaluation harness compares evidence against annotations.
Keeping the two apart prevents a research baseline (for example B0, the
training-set majority) from leaking into the product pipeline.

The protocol has two independent halves:

- **Technique assessment** compares criterion-level ratings on the same
  annotated action windows for every variant. No variant gets a different clip.
- **Event detection** compares confirmed intervals against annotated intervals
  separately, so a model is not rewarded for receiving manually selected clips.

Ratings stay ordinal. ``pose_rating`` only converts a measured value when the
caller supplies a validated mapping function; by default it abstains. This
prevents an unvalidated ideal-range heuristic from becoming a research label.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Iterable

from core.evidence import MEASURED_SOURCES

ORDINAL_RATINGS: tuple[str, ...] = ("not_demonstrated", "inconsistent", "functional", "consistent")
NON_SCORED_RATINGS: tuple[str, ...] = ("unable_to_assess", "not_applicable")
RATING_VALUES: dict[str, int] = {label: i + 1 for i, label in enumerate(ORDINAL_RATINGS)}
MODES: tuple[str, ...] = ("B0_MAJORITY", "B1_POSE_ONLY", "B2_VLM_ONLY", "B3_HYBRID", "B4_POSE_FALLBACK")

MANIFEST_REQUIRED = (
    "application", "sport_pack", "models", "prompt", "video", "camera", "environment",
)
MANIFEST_HASH_FIELDS = (
    ("application", "git_commit"),
    ("sport_pack", "sha256"),
    ("prompt", "hash"),
    ("video", "sha256"),
)


class EvaluationRejected(ValueError):
    """The result cannot enter an evaluation run because provenance is missing."""


@dataclass(frozen=True)
class AnnotatedWindow:
    """One independently annotated action window.

    ``ratings`` maps paper criterion IDs to ordinal ratings or one of the two
    non-scored states. The annotation is the same for every ablation variant.
    ``phase_boundaries`` optionally carries the independently annotated temporal
    spans for the action phases (E2); the runtime does not localize phases yet,
    so this is carried for the offline harness only.
    """

    clip_id: str
    start_s: float
    end_s: float
    event_confirmed: bool
    ratings: dict[str, str] = field(default_factory=dict)
    athlete_id: str | None = None
    session_id: str | None = None
    phase_boundaries: dict[str, tuple[float, float]] | None = None


@dataclass
class Observation:
    clip_id: str
    event_state: str
    ratings: dict[str, str]
    evidence: dict[str, dict]
    window: AnnotatedWindow


def validate_manifest(result: dict) -> dict:
    """Reject a result that cannot be reproduced.

    The paper promises a manifest with commit, pack checksum, model files,
    prompt version, video metadata, camera metadata and environment. An
    evaluation run must not silently accept a result missing those fields.
    """
    provenance = result.get("provenance") or {}
    manifest = provenance.get("manifest")
    if not isinstance(manifest, dict):
        raise EvaluationRejected("result has no provenance.manifest")
    missing = [key for key in MANIFEST_REQUIRED if not manifest.get(key)]
    if missing:
        raise EvaluationRejected(f"manifest missing required sections: {', '.join(missing)}")
    if not manifest["application"].get("git_commit"):
        raise EvaluationRejected("manifest is missing the application Git commit")
    if not manifest["sport_pack"].get("sha256"):
        raise EvaluationRejected("manifest is missing the sport-pack checksum")
    if not manifest["prompt"].get("hash"):
        raise EvaluationRejected("manifest is missing the prompt hash")
    if not manifest["video"].get("sha256"):
        raise EvaluationRejected("manifest is missing the video content hash")
    return manifest


def evaluation_version(result: dict) -> str:
    """A stable version for this exact model/pack/prompt/video configuration.

    A changed model, prompt, pack or video produces a different version, so two
    runs cannot be compared as if they came from the same system snapshot.
    """
    manifest = validate_manifest(result)
    parts = []
    for section, key in MANIFEST_HASH_FIELDS:
        value = (manifest.get(section) or {}).get(key)
        if not value:
            raise EvaluationRejected(f"manifest missing {section}.{key}")
        parts.append(f"{section}.{key}={value}")
    models = manifest.get("models") or {}
    parts.append(f"pose={((models.get('pose') or {}).get('sha256'))}")
    parts.append(f"vlm={((models.get('vlm') or {}).get('model_used'))}")
    parts.append(f"prompt_version={((manifest.get('prompt') or {}).get('version'))}")
    parts.append(f"preprocessing={json.dumps(manifest.get('preprocessing') or {}, sort_keys=True)}")
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return f"eval-{digest[:16]}"


def majority_baseline(training: Iterable[AnnotatedWindow]) -> dict[str, str]:
    """B0: per-criterion mode of the training annotations.

    The baseline is computed from training data only. It is a reference point,
    not a product output.
    """
    counts: dict[str, Counter] = {}
    for window in training:
        for criterion, rating in window.ratings.items():
            if rating in ORDINAL_RATINGS:
                counts.setdefault(criterion, Counter())[rating] += 1
    out = {}
    for criterion, counter in counts.items():
        top = max(counter.values())
        tied = [r for r in ORDINAL_RATINGS if counter.get(r) == top]
        out[criterion] = tied[0] if tied else "unable_to_assess"
    return out


def _overlaps(event: dict, window: AnnotatedWindow) -> bool:
    t = float(event.get("t", 0.0))
    return window.start_s <= t <= window.end_s


def _event_for(result: dict, window: AnnotatedWindow) -> dict | None:
    events = [e for e in result.get("events") or [] if _overlaps(e, window)]
    if not events:
        return None
    return min(events, key=lambda e: abs(float(e.get("t", 0.0)) - (window.start_s + window.end_s) / 2))


def _rows(event: dict | None) -> list[dict]:
    return list((event or {}).get("measurements") or [])


def _pose_rating(row: dict, rating_fn: Callable[[dict], str] | None) -> str:
    if row.get("source") not in MEASURED_SOURCES or row.get("state") != "valid":
        return "unable_to_assess"
    if row.get("value") is None:
        return "unable_to_assess"
    if rating_fn is None:
        return "unable_to_assess"
    rating = rating_fn(row)
    return rating if rating in ORDINAL_RATINGS or rating in NON_SCORED_RATINGS else "unable_to_assess"


def _vlm_rating(row: dict) -> str:
    rating = row.get("qualitative_rating")
    if row.get("source") == "vlm" and rating in ORDINAL_RATINGS:
        return rating
    if row.get("source") == "vlm" and rating in NON_SCORED_RATINGS:
        return rating
    return "unable_to_assess"


def observe(mode: str, result: dict, window: AnnotatedWindow,
            rating_fn: Callable[[dict], str] | None = None,
            baseline: dict[str, str] | None = None) -> Observation:
    """Produce one variant's observation for one annotated window."""
    if mode not in MODES:
        raise ValueError(f"unknown evaluation mode: {mode}")
    if mode == "B0_MAJORITY":
        ratings = {cid: (baseline or {}).get(cid, "unable_to_assess") for cid in window.ratings}
        return Observation(window.clip_id, "not_applicable", ratings, {}, window)

    event = _event_for(result, window)
    state = (event or {}).get("event_state") or "rejected"
    rows = _rows(event)
    ratings: dict[str, str] = {}
    evidence: dict[str, dict] = {}

    for row in rows:
        cid = row.get("criterion_id") or row.get("key")
        if not cid:
            continue
        evidence[cid] = {
            "source": row.get("source"),
            "state": row.get("state"),
            "value": row.get("value"),
            "qualitative_rating": row.get("qualitative_rating"),
            "criterion_id": cid,
        }
        if mode == "B1_POSE_ONLY" or mode == "B4_POSE_FALLBACK":
            ratings[cid] = _pose_rating(row, rating_fn)
        elif mode == "B2_VLM_ONLY":
            ratings[cid] = _vlm_rating(row)
        else:  # B3 hybrid: measured evidence first, judgement only as a fallback
            pose = _pose_rating(row, rating_fn)
            ratings[cid] = pose if pose not in ("unable_to_assess", "not_applicable") else _vlm_rating(row)

    for cid in window.ratings:
        ratings.setdefault(cid, "unable_to_assess")
    if mode == "B4_POSE_FALLBACK" and state == "candidate":
        # The fallback may report a candidate interval, but it must not be
        # counted as a confirmed event.
        state = "candidate"
    return Observation(window.clip_id, state, ratings, evidence, window)


def technique_agreement(observations: Iterable[Observation]) -> dict:
    """Ordinal agreement against the annotations, with abstentions kept visible."""
    pairs: list[tuple[str, str, str]] = []
    abstentions: Counter = Counter()
    for obs in observations:
        for criterion, gold in obs.window.ratings.items():
            predicted = obs.ratings.get(criterion, "unable_to_assess")
            if gold in NON_SCORED_RATINGS:
                abstentions[f"gold_{gold}"] += 1
                continue
            if predicted in NON_SCORED_RATINGS:
                abstentions[f"predicted_{predicted}"] += 1
                continue
            if gold in ORDINAL_RATINGS and predicted in ORDINAL_RATINGS:
                pairs.append((criterion, predicted, gold))
    n = len(pairs)
    exact = sum(1 for _, p, g in pairs if p == g)
    within_one = sum(1 for _, p, g in pairs if abs(RATING_VALUES[p] - RATING_VALUES[g]) <= 1)
    confusion = {g: {p: 0 for p in ORDINAL_RATINGS} for g in ORDINAL_RATINGS}
    for _, p, g in pairs:
        confusion[g][p] += 1
    macro = {}
    for label in ORDINAL_RATINGS:
        tp = sum(1 for _, p, g in pairs if p == label and g == label)
        fp = sum(1 for _, p, g in pairs if p == label and g != label)
        fn = sum(1 for _, p, g in pairs if p != label and g == label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        macro[label] = round(2 * precision * recall / (precision + recall), 3) if precision + recall else 0.0
    return {
        "n": n,
        "exact_agreement": round(exact / n, 3) if n else None,
        "within_one": round(within_one / n, 3) if n else None,
        "macro_f1": round(sum(macro.values()) / len(macro), 3) if n else None,
        "per_label_f1": macro,
        "confusion": confusion,
        "abstentions": dict(abstentions),
        "scale": list(ORDINAL_RATINGS),
        "conversion": "ordinal_only_no_linear_multiplier",
    }


def _interval(event: dict) -> tuple[float, float]:
    start = float(event.get("t", 0.0))
    end = start + float(event.get("duration_s", 2.5) or 2.5)
    return start, end


def _iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    return inter / union if union > 0 else 0.0


def event_detection_metrics(result: dict, annotations: Iterable[AnnotatedWindow],
                            iou_threshold: float = 0.5) -> dict:
    """Precision/recall/F1 for confirmed intervals, independent of technique."""
    predicted = [
        _interval(e) for e in result.get("events") or []
        if e.get("event_state") == "confirmed"
    ]
    gold = [(w.start_s, w.end_s) for w in annotations if w.event_confirmed]
    used: set[int] = set()
    matched = 0
    for start, end in gold:
        best, best_iou = None, 0.0
        for i, interval in enumerate(predicted):
            if i in used:
                continue
            score = _iou((start, end), interval)
            if score > best_iou:
                best, best_iou = i, score
        if best is not None and best_iou >= iou_threshold:
            used.add(best)
            matched += 1
    precision = matched / len(predicted) if predicted else None
    recall = matched / len(gold) if gold else None
    f1 = (2 * precision * recall / (precision + recall)
          if precision is not None and recall is not None and precision + recall else None)
    return {
        "iou_threshold": iou_threshold,
        "predicted_confirmed": len(predicted),
        "annotated_confirmed": len(gold),
        "matched": matched,
        "precision": round(precision, 3) if precision is not None else None,
        "recall": round(recall, 3) if recall is not None else None,
        "f1": round(f1, 3) if f1 is not None else None,
    }


def _phase_spans(result: dict) -> list[dict]:
    """Phase spans the runtime produced, if any.

    The runtime does not localize action phases yet. This reader exists so the
    E2 harness can consume a result that carries ``events[].phases`` without a
    special case once a phase localizer lands.
    """
    spans = []
    for event in result.get("events") or []:
        phases = event.get("phases") or {}
        for phase_id, span in phases.items():
            if isinstance(span, (list, tuple)) and len(span) == 2:
                spans.append({"phase_id": str(phase_id),
                              "start_s": float(span[0]), "end_s": float(span[1])})
    return spans


def phase_localization_metrics(result: dict, annotations: Iterable[AnnotatedWindow],
                               *, iou_threshold: float = 0.5) -> dict:
    """E2: phase boundary agreement, reported separately from event detection.

    Gold phases come from the independently annotated ``phase_boundaries`` on
    each window. The metric is computed per phase ID for a single clip; this
    matches the E2 protocol (one clip, one attempt, independently annotated
    boundaries), not a whole match. When the runtime produced no phase spans the
    report is honestly marked ``not_implemented`` rather than scored.
    """
    annotations = list(annotations)
    gold = {pid: span for window in annotations
            if window.phase_boundaries
            for pid, span in window.phase_boundaries.items()}
    windows_with_phases = sum(1 for w in annotations if w.phase_boundaries)
    detected_spans = _phase_spans(result)
    detected = {span["phase_id"]: (span["start_s"], span["end_s"])
                for span in detected_spans}
    if not detected:
        return {
            "status": "not_implemented",
            "annotated_phases": len(gold),
            "windows_with_phase_annotations": windows_with_phases,
            "detected_phases": 0,
            "matched": 0,
            "precision": None,
            "recall": None,
            "f1": None,
            "boundary_error_s": None,
            "note": "the runtime does not localize action phases yet; the E2 harness carries the annotations so phase segmentation can be scored when a localizer lands",
        }

    matched = 0
    boundary_errors: list[float] = []
    for pid, (g_start, g_end) in gold.items():
        det = detected.get(pid)
        if det is None:
            continue
        if _iou((g_start, g_end), det) >= iou_threshold:
            matched += 1
            boundary_errors.extend((abs(det[0] - g_start), abs(det[1] - g_end)))
    precision = matched / len(detected) if detected else None
    recall = matched / len(gold) if gold else None
    f1 = (2 * precision * recall / (precision + recall)
          if precision is not None and recall is not None and precision + recall else None)
    return {
        "status": "implemented",
        "annotated_phases": len(gold),
        "windows_with_phase_annotations": windows_with_phases,
        "detected_phases": len(detected),
        "matched": matched,
        "precision": round(precision, 3) if precision is not None else None,
        "recall": round(recall, 3) if recall is not None else None,
        "f1": round(f1, 3) if f1 is not None else None,
        "boundary_error_s": (round(sum(boundary_errors) / len(boundary_errors), 3)
                            if boundary_errors else None),
        "iou_threshold": iou_threshold,
    }


def evaluate(result: dict, annotations: Iterable[AnnotatedWindow], *,
             modes: Iterable[str] = MODES, training: Iterable[AnnotatedWindow] | None = None,
             rating_fn: Callable[[dict], str] | None = None,
             iou_threshold: float = 0.5) -> dict:
    """Run every requested variant on the same annotated windows.

    ``training`` is only used by B0. Event detection is reported separately and
    never shares the technique denominator.
    """
    annotations = list(annotations)
    manifest = validate_manifest(result)
    version = evaluation_version(result)
    baseline = majority_baseline(training or [])
    variants = {}
    for mode in modes:
        observations = [observe(mode, result, window, rating_fn=rating_fn, baseline=baseline)
                        for window in annotations]
        variants[mode] = {
            "technique": technique_agreement(observations),
            "event_detection": event_detection_metrics(result, annotations, iou_threshold),
        }
    return {
        "evaluation_version": version,
        "manifest": {
            "git_commit": manifest["application"].get("git_commit"),
            "sport_pack": manifest["sport_pack"],
            "prompt_hash": manifest["prompt"].get("hash"),
            "video_sha256": manifest["video"].get("sha256"),
        },
        "annotated_windows": len(annotations),
        "variants": variants,
        "phase_localization": phase_localization_metrics(result, annotations,
                                                        iou_threshold=iou_threshold),
        "notes": [
            "B0 is computed from training annotations only.",
            "Every variant receives the same annotated action windows.",
            "Event detection is reported separately from technique agreement.",
            "Phase segmentation is reported separately as E2 and is not_implemented in this runtime.",
        ],
    }


def research_view(result: dict) -> dict:
    """Strip product-only, unvalidated aggregate scores from a research export.

    Criterion-level measurements remain. The experimental rating and composite
    are removed rather than presented as research findings.
    """
    out = copy.deepcopy(result)
    removed = []
    summary = out.setdefault("summary", {})
    for key in ("rating", "average_score", "composite"):
        if key in summary:
            summary.pop(key, None)
            removed.append(f"summary.{key}")
    summary["scoring_status"] = "excluded_from_research"
    for event in out.get("events") or []:
        for key in ("score", "score_source"):
            if key in event:
                event.pop(key, None)
                removed.append(f"events[].{key}")
    for finding in out.get("findings") or []:
        if "form_score" in finding:
            finding.pop("form_score", None)
            removed.append("findings[].form_score")
    out["research_output"] = True
    out["experimental_fields_excluded"] = removed
    return out
