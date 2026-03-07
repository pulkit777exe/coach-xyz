from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
try:
    import mediapipe as mp
except Exception:
    mp = None

try:
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker,
        PoseLandmarkerOptions,
        RunningMode,
    )
except Exception:
    BaseOptions = None
    PoseLandmarker = None
    PoseLandmarkerOptions = None
    RunningMode = None


# Fallback for runtimes where mp.solutions.pose is not shipped.
_POSE_CONNECTIONS_FALLBACK: list[tuple[int, int]] = [
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 7),
    (0, 4),
    (4, 5),
    (5, 6),
    (6, 8),
    (9, 10),
    (11, 12),
    (11, 13),
    (13, 15),
    (15, 17),
    (15, 19),
    (15, 21),
    (17, 19),
    (12, 14),
    (14, 16),
    (16, 18),
    (16, 20),
    (16, 22),
    (18, 20),
    (11, 23),
    (12, 24),
    (23, 24),
    (23, 25),
    (24, 26),
    (25, 27),
    (26, 28),
    (27, 29),
    (28, 30),
    (29, 31),
    (30, 32),
    (27, 31),
    (28, 32),
]


def _default_model_path() -> Path:
    return (Path(__file__).resolve().parent.parent / "pose_landmarker_full.task").resolve()


def pose_backend_name() -> str:
    pose_root = getattr(mp, "solutions", None) if mp is not None else None
    if pose_root is not None and hasattr(pose_root, "pose"):
        return "solutions"

    if (
        PoseLandmarker is not None
        and PoseLandmarkerOptions is not None
        and BaseOptions is not None
        and RunningMode is not None
    ):
        return "tasks"

    return "unavailable"


def pose_backend_available() -> bool:
    return pose_backend_name() in {"solutions", "tasks"}


def get_pose_connections() -> list[tuple[int, int]]:
    pose_root = getattr(mp, "solutions", None) if mp is not None else None
    if pose_root is not None and hasattr(pose_root, "pose"):
        return list(pose_root.pose.POSE_CONNECTIONS)
    return list(_POSE_CONNECTIONS_FALLBACK)


class StaticPoseDetector:
    """
    Unified image-mode pose detector across both MediaPipe backends:
    - `mp.solutions.pose.Pose` (legacy)
    - `mediapipe.tasks.vision.PoseLandmarker` (current)
    """

    def __init__(self, min_detection_confidence: float = 0.5, num_poses: int = 6) -> None:
        self.mode = pose_backend_name()
        self._detector: Any = None

        if self.mode == "solutions":
            pose_root = mp.solutions
            self._detector = pose_root.pose.Pose(
                static_image_mode=True,
                model_complexity=1,
                min_detection_confidence=float(min_detection_confidence),
            )
            return

        if self.mode == "tasks":
            model_path = _default_model_path()
            if not model_path.exists():
                raise RuntimeError(
                    f"MediaPipe tasks backend is available but model file is missing: {model_path}"
                )

            options = PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(model_path)),
                running_mode=RunningMode.IMAGE,
                num_poses=max(1, int(num_poses)),
                min_pose_detection_confidence=float(min_detection_confidence),
            )
            self._detector = PoseLandmarker.create_from_options(options)
            return

        raise RuntimeError(
            "MediaPipe Pose backend unavailable in installed mediapipe package "
            "(neither mp.solutions.pose nor mediapipe.tasks PoseLandmarker is available)"
        )

    def __enter__(self) -> "StaticPoseDetector":
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _tb: Any) -> None:
        self.close()

    def close(self) -> None:
        if self._detector is None:
            return
        try:
            self._detector.close()
        except Exception:
            pass
        self._detector = None

    def detect(self, frame_bgr: Any) -> list[list[dict[str, float]]]:
        if frame_bgr is None:
            return []

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        if self.mode == "solutions":
            result = self._detector.process(rgb)
            pose_landmarks = getattr(result, "pose_landmarks", None)
            if not pose_landmarks:
                return []
            return [self._solution_landmarks_to_dicts(pose_landmarks)]

        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._detector.detect(mp_image)
        return self._task_landmarks_to_dicts(getattr(result, "pose_landmarks", None))

    @staticmethod
    def _solution_landmarks_to_dicts(result_landmarks: Any) -> list[dict[str, float]]:
        return [
            {
                "x": float(lm.x),
                "y": float(lm.y),
                "z": float(lm.z),
                "visibility": float(getattr(lm, "visibility", 1.0)),
            }
            for lm in result_landmarks.landmark
        ]

    @staticmethod
    def _task_landmarks_to_dicts(pose_landmarks: Any) -> list[list[dict[str, float]]]:
        if not pose_landmarks:
            return []

        out: list[list[dict[str, float]]] = []
        for skeleton in pose_landmarks:
            parsed = [
                {
                    "x": float(getattr(lm, "x", 0.0)),
                    "y": float(getattr(lm, "y", 0.0)),
                    "z": float(getattr(lm, "z", 0.0)),
                    "visibility": float(getattr(lm, "visibility", 1.0)),
                }
                for lm in skeleton
            ]
            if parsed:
                out.append(parsed)
        return out
