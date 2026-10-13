"""Tests for the biomechanics seam in core.biomechanics (extracted from analyzer)."""

from core.biomechanics import attach_biomechanical_metrics, compute_injury_risk


def _track(ts, **overrides):
    base = {
        "timestamp": ts,
        "frame_index": int(ts * 30),
        "landmarks": [{"x": 0.5, "y": 0.5, "visibility": 0.9} for _ in range(33)],
        "joint_angles": {"knee_angle_deg": 150.0},
        "elbow_extension_angle": 160.0,
        "visibility": 0.9,
    }
    base.update(overrides)
    return base


class TestAttachBiomechanicalMetrics:
    def test_attaches_nearest_track_metrics(self):
        events = [{"timestamp": 1.0}]
        attach_biomechanical_metrics(events, [_track(0.9), _track(5.0)])
        bio = events[0]["biomechanics"]
        assert bio["joint_angles"] == {"knee_angle_deg": 150.0}
        assert bio["elbow_extension_angle"] == 160.0
        assert bio["measured_at_timestamp"] == 0.9

    def test_skips_events_far_from_any_track(self):
        events = [{"timestamp": 100.0}]
        attach_biomechanical_metrics(events, [_track(0.9)])
        assert "biomechanics" not in events[0]

    def test_no_tracks_is_a_no_op(self):
        events = [{"timestamp": 1.0}]
        attach_biomechanical_metrics(events, [])
        assert "biomechanics" not in events[0]


class TestComputeInjuryRisk:
    def test_no_tracks_is_a_no_op(self):
        events = [{"timestamp": 1.0, "event_type": "swing"}]
        compute_injury_risk(events, [])
        assert "injury_risk" not in events[0]

    def test_far_events_are_untouched(self):
        events = [{"timestamp": 100.0, "event_type": "swing"}]
        compute_injury_risk(events, [_track(0.9)])
        assert "injury_risk" not in events[0]

    def test_nearby_tracks_delegate_without_crashing(self):
        events = [{"timestamp": 1.0, "event_type": "swing"}]
        compute_injury_risk(events, [_track(0.9)])
        assert events[0].get("injury_risk") is None or isinstance(
            events[0].get("injury_risk"), dict
        )
