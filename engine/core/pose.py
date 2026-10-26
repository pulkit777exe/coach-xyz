"""MediaPipe pose landmarker, one instance per job.

`detect` returns one (33, 4) array of x, y, z, visibility per person, with x and
y normalized to the image that was passed in. Tests swap `create` for a fake.
"""

import logging
import os
import tempfile
from pathlib import Path

import httpx
import numpy as np

from . import config
from .errors import EngineError

log = logging.getLogger("engine.pose")
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{v}/float16/latest/pose_landmarker_{v}.task"


def model_path() -> Path:
    s = config.settings
    if s.pose_model_path:
        return Path(s.pose_model_path)
    return s.data_dir / "models" / f"pose_landmarker_{s.pose_model}.task"


def ensure_model() -> Path:
    path = model_path()
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    url = MODEL_URL.format(v=config.settings.pose_model)
    log.info("downloading pose model %s", url)
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            fd, tmp = tempfile.mkstemp(dir=path.parent)
            with os.fdopen(fd, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        os.replace(tmp, path)
    except Exception as exc:
        raise EngineError("POSE_MODEL_MISSING", "Pose model is not available on the engine.",
                          retryable=True, status=503) from exc
    return path


class Pose:
    def __init__(self) -> None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

        self._mp = mp
        path = str(ensure_model())

        def make(people: int):
            return PoseLandmarker.create_from_options(PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=path),
                running_mode=RunningMode.IMAGE,
                num_poses=people,
                min_pose_detection_confidence=0.5,
                min_pose_presence_confidence=0.5,
            ))

        self._make = make
        self._landmarkers: dict[int, object] = {}

    def detect(self, bgr: np.ndarray, max_people: int = 1) -> list[np.ndarray]:
        landmarker = self._landmarkers.get(max_people)
        if landmarker is None:
            landmarker = self._landmarkers[max_people] = self._make(max_people)
        rgb = np.ascontiguousarray(bgr[:, :, ::-1])
        result = landmarker.detect(self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb))
        return [
            np.array([[p.x, p.y, p.z, p.visibility] for p in person], dtype=np.float32)
            for person in result.pose_landmarks
        ]

    def close(self) -> None:
        for landmarker in self._landmarkers.values():
            landmarker.close()
        self._landmarkers.clear()


def create() -> Pose:
    return Pose()
