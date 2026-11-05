"""Offline research evaluation harness (not part of the runtime pipeline)."""

from .protocol import (  # noqa: F401
    AnnotatedWindow,
    EvaluationRejected,
    MODES,
    Observation,
    evaluate,
    evaluation_version,
    event_detection_metrics,
    majority_baseline,
    observe,
    phase_localization_metrics,
    research_view,
    technique_agreement,
    validate_manifest,
)
