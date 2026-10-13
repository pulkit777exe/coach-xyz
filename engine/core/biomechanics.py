"""biomechanics.py — Deterministic biomechanical attachments.

Owns nearest-track metric attachment (joint angles, elbow extension,
confidence) plus injury-risk delegation to `core/injury_risk`. The injury
math itself stays in `core/injury_risk` (medical-gated downstream) — this
module only resolves which track each event reads. Called from
`core/analyzer.py::_stage_scoring`.
"""

from __future__ import annotations


def attach_biomechanical_metrics(
    shot_events: list[dict],
    active_tracks: list[dict],
) -> None:
    """
    Attach deterministic joint-angle metrics to each shot event by
    looking up the nearest tracked frame for the event timestamp.

    Mutates each event dict in-place, adding a `biomechanics` key with
    per-joint measurements and confidence scores.
    """
    import bisect

    # Build a sorted list of (timestamp, track) for binary search
    sorted_tracks = sorted(
        [t for t in active_tracks if t.get("landmarks")],
        key=lambda t: t["timestamp"],
    )
    if not sorted_tracks:
        return

    timestamps = [t["timestamp"] for t in sorted_tracks]

    for event in shot_events:
        event_ts = event.get("timestamp")
        if event_ts is None:
            continue

        # Find the nearest track by timestamp
        idx = bisect.bisect_left(timestamps, event_ts)
        if idx >= len(sorted_tracks):
            idx = len(sorted_tracks) - 1
        elif idx > 0 and abs(event_ts - timestamps[idx - 1]) < abs(event_ts - timestamps[idx]):
            idx = idx - 1

        track = sorted_tracks[idx]
        time_delta = abs(event_ts - track["timestamp"])

        # Only attach metrics if the track is within 2 seconds of the event
        if time_delta > 2.0:
            continue

        biomechanics: dict = {}

        # Joint angles from deterministic pose geometry
        joint_angles = track.get("joint_angles", {})
        if joint_angles:
            biomechanics["joint_angles"] = joint_angles

        # Elbow extension angle (key metric for shooting sports)
        elbow_ext = track.get("elbow_extension_angle")
        if elbow_ext is not None:
            biomechanics["elbow_extension_angle"] = round(elbow_ext, 1)

        # Visibility-based confidence (higher visibility = more reliable)
        visibility = track.get("visibility", 0.5)
        biomechanics["confidence"] = round(visibility, 2)

        # Frame reference
        biomechanics["measured_at_frame"] = track.get("frame_index")
        biomechanics["measured_at_timestamp"] = track.get("timestamp")

        if biomechanics:
            event["biomechanics"] = biomechanics

def compute_injury_risk(
    shot_events: list[dict],
    active_tracks: list[dict],
) -> None:
    """
    Compute injury-risk indicators for each shot event.

    Flags biomechanical patterns associated with elevated injury risk:
    - Knee valgus > 10° during landing (ACL risk)
    - Spine flexion > 45° under load (lumbar disc risk)
    - Arm slot drift (UCL stress in overhead athletes)
    """
    from core.injury_risk import compute_all_indicators

    # Build sorted tracks by timestamp
    sorted_tracks = sorted(
        [t for t in active_tracks if t.get("landmarks")],
        key=lambda t: t["timestamp"],
    )
    if not sorted_tracks:
        return

    timestamps = [t["timestamp"] for t in sorted_tracks]

    for event in shot_events:
        event_ts = event.get("timestamp")
        if event_ts is None:
            continue

        # Find nearest track
        import bisect as _bisect

        idx = _bisect.bisect_left(timestamps, event_ts)
        if idx >= len(sorted_tracks):
            idx = len(sorted_tracks) - 1
        elif idx > 0 and abs(event_ts - timestamps[idx - 1]) < abs(event_ts - timestamps[idx]):
            idx = idx - 1

        track = sorted_tracks[idx]
        time_delta = abs(event_ts - track["timestamp"])
        if time_delta > 2.0:
            continue

        landmarks = track.get("landmarks", [])
        if not landmarks:
            continue

        indicators = compute_all_indicators(landmarks, event.get("event_type", "unknown"))
        if indicators:
            event["injury_risk"] = indicators
