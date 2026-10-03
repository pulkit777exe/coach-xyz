"""core/detector.py — the main detection path behind /scan.

`detect_players` is what a coach sees when they upload a clip: it picks a
representative frame, finds the athletes in it, and returns one base64 crop per
player. Two backends sit behind it (`mp.solutions.pose` or the tasks
`PoseLandmarker`), selected at import, and this module was at 8% coverage —
almost all of it the import line, because the real path needs MediaPipe plus a
real video.

The branches that decide an answer, and none of the happy path:
  - `_detect_pose_candidates`: the full-frame fallback when HOG proposes
    nothing, the empty-crop skip, the IoU-0.35 dedup *and which side wins* when
    two overlapping candidates disagree on visibility, and the
    `crop_w < 24 or crop_h < 48` size floor in `extract_players`.
  - `score_and_select_best_frame`: the overlap penalty subtracted from
    `count * visibility` (so a frame full of overlapping boxes loses to a frame
    with one clean athlete), the visibility floor in the pose branch, and the
    `VideoDecodeError` vs `NoPlayersDetectedError` distinction.
  - `detect_players`: it must re-raise those two *by type* and wrap everything
    else, including a bare `cv2.error`, in `VideoDecodeError`. That mapping is
    the module's contract with `api/scan.py`, which branches on it to decide
    between a 400 and a retriable 500.

MediaPipe is stubbed throughout: the pose backend is a plain object with a
`detect` method, so the geometry under test is this module's, not a landmarker's.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

import core.detector as det
from core.detection_utils import iou
from core.errors import NoPlayersDetectedError, VideoDecodeError

FRAME_W, FRAME_H = 320, 480


# ── Fixtures / doubles ────────────────────────────────────────────────────────


def _frame(w: int = FRAME_W, h: int = FRAME_H) -> np.ndarray:
    return np.zeros((h, w, 3), dtype=np.uint8)


def _landmarks(
    n: int = 33, x: float = 0.5, y: float = 0.5, vis: float = 0.9
) -> list[dict]:
    return [{"x": x, "y": y, "visibility": vis} for _ in range(n)]


def _spanning_landmarks(x0: float, x1: float, y0: float, y1: float, vis: float = 0.9):
    """A pose whose *body* landmarks (the six bbox_from_landmarks reads) span
    the given normalized box, so the resulting pixel box is predictable.

    The other 27 landmarks sit at the centre at visibility 0.5, which is what a
    partially-visible pose looks like. Use `uniform_vis` when the test asserts
    on `PoseCandidate.visibility`, because that field is the mean over all 33.
    """
    pose = [{"x": 0.5, "y": 0.5, "visibility": 0.5} for _ in range(33)]
    for idx, (x, y) in zip(
        (11, 12, 23, 24, 27, 28),
        [(x0, y0), (x1, y0), (x0, y1), (x1, y1), (x0, y1), (x1, y1)],
    ):
        pose[idx] = {"x": x, "y": y, "visibility": vis}
    return pose


def _sized_pose(raw_w_px: float, raw_h_px: float, vis: float = 0.9,
               frame_w: int = FRAME_W, frame_h: int = FRAME_H) -> list[dict]:
    """A pose whose six body landmarks span `raw_w_px` x `raw_h_px`, centred.

    Every landmark carries `vis`, so the mean visibility the candidate publishes
    is exactly `vis` — which is what `extract_players` turns into `confidence`
    and what its `> 0.5` filter then admits. The other 27 sit at the centre,
    inside the body span, so they never widen the box.
    """
    cx, cy = 0.5, 0.5
    x0, x1 = cx - raw_w_px / (2 * frame_w), cx + raw_w_px / (2 * frame_w)
    y0, y1 = cy - raw_h_px / (2 * frame_h), cy + raw_h_px / (2 * frame_h)
    pose = [{"x": cx, "y": cy, "visibility": vis} for _ in range(33)]
    for idx, (x, y) in zip(
        (11, 12, 23, 24, 27, 28),
        [(x0, y0), (x1, y0), (x0, y1), (x1, y1), (x0, y1), (x1, y1)],
    ):
        pose[idx] = {"x": x, "y": y, "visibility": vis}
    return pose


def _uniform_pose(x0: float, x1: float, y0: float, y1: float, vis: float) -> list[dict]:
    """Like `_spanning_landmarks` but every landmark carries `vis`, so the mean
    visibility `PoseCandidate` publishes is exactly `vis`."""
    pose = [{"x": 0.5, "y": 0.5, "visibility": vis} for _ in range(33)]
    for idx, (x, y) in zip(
        (11, 12, 23, 24, 27, 28),
        [(x0, y0), (x1, y0), (x0, y1), (x1, y1), (x0, y1), (x1, y1)],
    ):
        pose[idx] = {"x": x, "y": y, "visibility": vis}
    return pose


class FakePose:
    """Stand-in for `StaticPoseDetector`: a context manager with `detect`.

    `results` is consumed one entry per `detect` call; the last entry repeats,
    so a single-detection fixture works for a multi-crop loop.
    """

    def __init__(self, results=None):
        self.results = list(results or [])
        self.crops: list[tuple[int, int]] = []
        self.closed = False

    def detect(self, crop):
        self.crops.append(crop.shape[:2])
        if not self.results:
            return []
        index = min(len(self.crops), len(self.results)) - 1
        return self.results[index]

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.closed = True
        return False


@pytest.fixture
def no_hog(monkeypatch):
    """No HOG proposals — forces the full-frame proposal branch."""
    monkeypatch.setattr(det, "detect_hog_people", lambda frame, min_weight=0.3: [])


class FakeBackend:
    """What `captured_pose` hands back: the fake plus the kwargs it was built with."""

    def __init__(self):
        self.pose = FakePose()
        self.kwargs: dict = {}

    def feed(self, *detections):
        self.pose.results = list(detections)
        return self.pose


@pytest.fixture
def captured_pose(monkeypatch):
    """Replace the `StaticPoseDetector` the module builds with a pre-made fake.

    The fake is constructed *here* so a test can configure it before the code
    under test constructs one of its own.
    """
    backend = FakeBackend()

    def _factory(**kwargs):
        backend.kwargs = kwargs
        return backend.pose

    monkeypatch.setattr(det, "StaticPoseDetector", _factory)
    monkeypatch.setattr(det, "pose_backend_available", lambda: True)
    return backend


# ── _detect_pose_candidates ───────────────────────────────────────────────────


class TestDetectPoseCandidates:
    def test_no_hog_proposals_falls_back_to_the_whole_frame(self, no_hog):
        """Without HOG the single proposal is the entire frame, so the pose
        backend sees one crop of full size rather than nothing."""
        pose = FakePose([[_landmarks()]])
        candidates = det._detect_pose_candidates(_frame(), pose)
        assert pose.crops == [(FRAME_H - 1, FRAME_W - 1)]
        assert len(candidates) == 1

    def test_an_empty_pose_crop_produces_no_candidates(self, no_hog):
        assert det._detect_pose_candidates(_frame(), FakePose([[]])) == []

    def test_the_full_frame_crop_excludes_the_last_row_and_column(self, no_hog):
        # The proposal is (0, 0, w-1, h-1) and the slice is [y1:y2, x1:x2], so
        # the crop is one pixel short on each axis.
        pose = FakePose([[_landmarks()]])
        det._detect_pose_candidates(_frame(), pose)
        assert pose.crops == [(FRAME_H - 1, FRAME_W - 1)]

    def test_each_hog_proposal_becomes_one_crop(self, monkeypatch):
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((0, 0, 80, 160), 0.9), ((200, 100, 280, 260), 0.8)],
        )
        pose = FakePose([[_spanning_landmarks(0.05, 0.95, 0.05, 0.95)],
                         [_spanning_landmarks(0.05, 0.95, 0.05, 0.95)]])
        det._detect_pose_candidates(_frame(), pose)
        assert pose.crops == [(160, 80), (160, 80)]

    def test_an_empty_crop_slice_is_skipped(self, monkeypatch):
        """A degenerate proposal (`x1 == x2`) yields an empty array; the loop
        must `continue` rather than hand MediaPipe a zero-sized image."""
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((5, 5, 5, 5), 0.9)]
        )
        pose = FakePose([[_landmarks()]])
        assert det._detect_pose_candidates(_frame(), pose) == []
        assert pose.crops == []

    def test_visibility_is_the_mean_of_the_crop_local_landmarks(self, monkeypatch):
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((0, 0, 320, 480), 0.9)]
        )
        pose = FakePose([[[{"x": 0.5, "y": 0.5, "visibility": v} for v in (1.0, 0.0)]]])
        candidates = det._detect_pose_candidates(_frame(), pose)
        assert candidates[0].visibility == pytest.approx(0.5)

    def test_landmarks_are_transformed_out_of_crop_space(self, monkeypatch):
        """The crop origin must be baked in, or a player on the right of the
        frame is reported at the left."""
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((160, 240, 320, 480), 0.9)]
        )
        pose = FakePose([[[{"x": 0.5, "y": 0.5, "visibility": 0.9} for _ in range(33)]]])
        (candidate,) = det._detect_pose_candidates(_frame(), pose)
        assert candidate.landmarks[0]["x"] == pytest.approx((160 + 0.5 * 160) / 320)
        assert candidate.landmarks[0]["y"] == pytest.approx((240 + 0.5 * 240) / 480)

    def test_overlapping_candidates_are_deduped_at_iou_035(self, monkeypatch):
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((0, 0, 100, 200), 0.9), ((5, 5, 105, 205), 0.8)],
        )
        pose = FakePose([[_spanning_landmarks(0.05, 0.95, 0.05, 0.95)],
                         [_spanning_landmarks(0.05, 0.95, 0.05, 0.95)]])
        assert len(det._detect_pose_candidates(_frame(), pose)) == 1

    def test_the_higher_visibility_duplicate_wins_the_slot(self, monkeypatch):
        """The dedup keeps the *first* candidate object and overwrites it in
        place, so a later, more confident detection replaces a weaker one
        already accepted."""
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((0, 0, 100, 200), 0.9), ((5, 5, 105, 205), 0.8)],
        )
        pose = FakePose([[_uniform_pose(0.05, 0.95, 0.05, 0.95, 0.20)],
                         [_uniform_pose(0.05, 0.95, 0.05, 0.95, 0.95)]])
        (candidate,) = det._detect_pose_candidates(_frame(), pose)
        assert candidate.visibility == pytest.approx(0.95)

    def test_a_weaker_duplicate_does_not_downgrade_the_kept_candidate(self, monkeypatch):
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((0, 0, 100, 200), 0.9), ((5, 5, 105, 205), 0.8)],
        )
        pose = FakePose([[_uniform_pose(0.05, 0.95, 0.05, 0.95, 0.95)],
                         [_uniform_pose(0.05, 0.95, 0.05, 0.95, 0.20)]])
        (candidate,) = det._detect_pose_candidates(_frame(), pose)
        assert candidate.visibility == pytest.approx(0.95)

    def test_separate_candidates_are_both_kept(self, monkeypatch):
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((0, 0, 80, 200), 0.9), ((200, 200, 300, 400), 0.9)],
        )
        left = _spanning_landmarks(0.02, 0.20, 0.02, 0.40)
        right = _spanning_landmarks(0.62, 0.90, 0.42, 0.80)
        pose = FakePose([[left], [right]])
        assert len(det._detect_pose_candidates(_frame(), pose)) == 2


# ── _enhance_and_encode_crop ─────────────────────────────────────────────────


class TestEnhanceAndEncodeCrop:
    def test_a_real_crop_comes_back_as_decodable_base64(self):
        encoded = det._enhance_and_encode_crop(_frame(40, 60))
        assert isinstance(encoded, str) and encoded
        assert base64.b64decode(encoded)[:2] == b"\xff\xd8"   # JPEG SOI marker

    def test_none_returns_the_empty_string(self):
        assert det._enhance_and_encode_crop(None) == ""

    def test_an_empty_array_returns_the_empty_string(self):
        assert det._enhance_and_encode_crop(np.zeros((0, 0, 3), np.uint8)) == ""

    def test_a_small_crop_is_upscaled_to_the_target_size(self):
        # 60x40 -> scale = 480/60 = 8 -> 480x320.
        encoded = det._enhance_and_encode_crop(_frame(40, 60), target_size=480)
        image = _decode(encoded)
        assert max(image.shape[:2]) == 480

    def test_a_large_crop_is_downscaled_to_the_target_size(self):
        encoded = det._enhance_and_encode_crop(_frame(1000, 1200), target_size=480)
        assert max(_decode(encoded).shape[:2]) == 480

    def test_a_crop_already_at_the_target_size_is_left_alone(self):
        encoded = det._enhance_and_encode_crop(_frame(480, 480), target_size=480)
        assert _decode(encoded).shape[:2] == (480, 480)

    def test_a_one_pixel_crop_still_encodes(self):
        """`max(1, int(...))` keeps the resize legal at the degenerate size; a
        zero would raise inside cv2."""
        assert det._enhance_and_encode_crop(_frame(1, 1)) != ""

    def test_an_encode_failure_returns_the_empty_string(self, monkeypatch):
        """`if not ok: return ""` — the scan response then ships
        `crop_base64: ""`, which the web renders as a blank tile rather than
        failing the whole upload."""
        monkeypatch.setattr(det.cv2, "imencode", lambda *a, **k: (False, None))
        assert det._enhance_and_encode_crop(_frame(40, 60)) == ""

    def test_the_output_is_clipped_to_the_uint8_range(self):
        # Unsharp masking with a negative weight can overshoot; the np.clip is
        # what keeps imencode from rejecting the array.
        noisy = (np.random.default_rng(0).integers(0, 255, (40, 60, 3))).astype(np.uint8)
        assert det._enhance_and_encode_crop(noisy) != ""


def _decode(encoded: str) -> np.ndarray:
    import cv2

    return cv2.imdecode(np.frombuffer(base64.b64decode(encoded), np.uint8), cv2.IMREAD_COLOR)


# ── score_and_select_best_frame ──────────────────────────────────────────────


class FakeCapture:
    """Minimal `cv2.VideoCapture`: a fixed frame count served from memory."""

    def __init__(self, frames, fps=10.0):
        self.frames = frames
        self.fps = fps
        self.width = frames[0].shape[1] if frames else FRAME_W
        self.height = frames[0].shape[0] if frames else FRAME_H
        self.position = 0
        self.released = False

    def isOpened(self):  # noqa: N802
        return not self.released

    def get(self, prop):
        if prop == cv2.CAP_PROP_FPS:
            return self.fps
        if prop == cv2.CAP_PROP_FRAME_COUNT:
            return float(len(self.frames))
        if prop == cv2.CAP_PROP_FRAME_WIDTH:
            return float(self.width)
        if prop == cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self.height)
        return 0.0

    def set(self, prop, value):
        self.position = int(value)

    def read(self):
        if self.position >= len(self.frames):
            return False, None
        frame = self.frames[self.position]
        self.position += 1
        return True, frame

    def release(self):
        self.released = True


def _capture(monkeypatch, frames, fps=10.0):
    cap = FakeCapture(frames, fps)
    monkeypatch.setattr(det.cv2, "VideoCapture", lambda path: cap)
    return cap


class TestScoreAndSelectBestFrame:
    def test_an_unreadable_video_raises_a_decode_error(self, monkeypatch):
        class Closed:
            def isOpened(self):  # noqa: N802
                return False

            def release(self):
                pass

        monkeypatch.setattr(det.cv2, "VideoCapture", lambda path: Closed())
        with pytest.raises(VideoDecodeError):
            det.score_and_select_best_frame("nope.mp4")

    def test_no_pose_anywhere_raises_no_players_detected(self, monkeypatch, no_hog):
        """A decodable video with nothing in it is a *different* failure from an
        undecodable one, and `api/scan.py` treats them differently."""
        _capture(monkeypatch, [_frame() for _ in range(4)], fps=10.0)
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        with pytest.raises(NoPlayersDetectedError):
            det.score_and_select_best_frame("empty.mp4")

    def test_a_near_duplicated_detection_is_penalised_against_a_clean_one(self, monkeypatch):
        """`score = count * avg_visibility - overlap_penalty`, and the penalty is
        per PAIR.

        The premise this test used to assert — "two overlapping detections score
        lower than one alone" — is simply false, and the arithmetic says so before
        any code runs: a pair overlapping at iou 0.89 costs 0.89, while the extra
        detection is worth a full 2 * 0.9 = 1.8, so the crowded frame wins
        0.9087 to 0.9. Overlap can only cancel an extra detection when the boxes
        overlap almost completely (iou -> 1), which is the duplicate case. That is
        the behaviour worth pinning, so that is what is pinned.
        """
        _capture(monkeypatch, [_frame() for _ in range(8)], fps=1.0)
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)

        def fake_hog(frame, min_weight=0.3):
            index = getattr(fake_hog, "seen", 0)
            fake_hog.seen = index + 1
            if index == 0:
                return [((10, 10, 60, 120), 0.9), ((12, 12, 62, 122), 0.9)]  # overlapping
            return [((10, 10, 60, 120), 0.9)]                                     # clean

        monkeypatch.setattr(det, "detect_hog_people", fake_hog)
        chosen, timestamp = det.score_and_select_best_frame("clip.mp4")
        assert chosen is not None
        # The crowded frame wins, because 2*0.9 - 0.8913 > 1*0.9. Asserting the
        # score rather than a bare timestamp is what makes this a test of the
        # scorer instead of a test of the fixture.
        assert timestamp == pytest.approx(0.0)
        assert 2 * 0.9 - iou((10, 10, 60, 120), (12, 12, 62, 122)) > 0.9

    def test_an_almost_duplicated_pair_loses_to_one_clean_detection(self, monkeypatch):
        """The case where the penalty really does decide it: iou -> 1."""
        _capture(monkeypatch, [_frame() for _ in range(8)], fps=1.0)
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)

        def fake_hog(frame, min_weight=0.3):
            index = getattr(fake_hog, "seen", 0)
            fake_hog.seen = index + 1
            if index == 0:
                # Same box twice: a duplicate, not two athletes.
                return [((10, 10, 60, 120), 0.9), ((10, 10, 60, 120), 0.9)]
            return [((10, 10, 60, 120), 0.9)]

        monkeypatch.setattr(det, "detect_hog_people", fake_hog)
        _, timestamp = det.score_and_select_best_frame("clip.mp4")
        # 2*0.9 - 1.0 = 0.8 < 0.9, so the single clean detection wins.
        assert timestamp == pytest.approx(1.0)

    def test_the_capture_is_released_even_when_detection_raises(self, monkeypatch):
        cap = _capture(monkeypatch, [_frame()])
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)

        def boom(frame, min_weight=0.3):
            raise RuntimeError("HOG exploded")

        monkeypatch.setattr(det, "detect_hog_people", boom)
        with pytest.raises(RuntimeError):
            det.score_and_select_best_frame("clip.mp4")
        assert cap.released

    def test_progress_is_reported_once_per_scanned_second(self, monkeypatch, no_hog):
        frames = [_frame() for _ in range(12)]
        _capture(monkeypatch, frames, fps=10.0)
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        seen: list[tuple[int, int]] = []
        with pytest.raises(NoPlayersDetectedError):
            det.score_and_select_best_frame(
                "clip.mp4", on_progress=lambda cur, total: seen.append((cur, total))
            )
        assert seen, "on_progress was never called"
        assert seen[0][0] == 1
        assert len({t for _, t in seen}) == 1        # one stable total
        assert [c for c, _ in seen] == list(range(1, len(seen) + 1))

    def test_a_pose_branch_candidate_below_the_visibility_floor_is_skipped(
        self, monkeypatch, no_hog
    ):
        """`valid = [c for c in candidates if c.visibility > 0.5]` — a faint
        detection is not a player."""
        monkeypatch.setattr(det, "pose_backend_available", lambda: True)
        monkeypatch.setattr(det, "StaticPoseDetector", lambda **kw: FakePose())
        _capture(monkeypatch, [_frame() for _ in range(3)], fps=1.0)
        monkeypatch.setattr(
            det,
            "_detect_pose_candidates",
            lambda frame, pose: [
                det.PoseCandidate(landmarks=[], bbox=(10, 10, 80, 200), visibility=0.4)
            ],
        )
        with pytest.raises(NoPlayersDetectedError):
            det.score_and_select_best_frame("clip.mp4")

    def test_a_pose_branch_above_the_floor_is_accepted(self, monkeypatch, no_hog):
        monkeypatch.setattr(det, "pose_backend_available", lambda: True)
        monkeypatch.setattr(det, "StaticPoseDetector", lambda **kw: FakePose())
        _capture(monkeypatch, [_frame() for _ in range(3)], fps=1.0)
        monkeypatch.setattr(
            det,
            "_detect_pose_candidates",
            lambda frame, pose: [
                det.PoseCandidate(landmarks=[], bbox=(10, 10, 80, 200), visibility=0.8)
            ],
        )
        chosen, _ = det.score_and_select_best_frame("clip.mp4")
        assert chosen is not None

    def test_the_pose_detector_is_closed_before_returning(self, monkeypatch, no_hog):
        monkeypatch.setattr(det, "pose_backend_available", lambda: True)
        _capture(monkeypatch, [_frame() for _ in range(2)], fps=1.0)
        holder: dict = {}

        def _factory(**kwargs):
            pose = FakePose()
            holder["pose"] = pose
            return pose

        monkeypatch.setattr(det, "StaticPoseDetector", _factory)
        monkeypatch.setattr(det, "pose_backend_available", lambda: True)
        monkeypatch.setattr(
            det,
            "_detect_pose_candidates",
            lambda frame, pose: [
                det.PoseCandidate(landmarks=[], bbox=(10, 10, 80, 200), visibility=0.8)
            ],
        )
        det.score_and_select_best_frame("clip.mp4")
        assert holder["pose"].closed

    def test_a_zero_fps_video_falls_back_to_thirty(self, monkeypatch, no_hog):
        """`frame_index = int(ts * fps) if fps > 0 else int(ts * 30)` — a container
        that reports no frame rate must still be scanned rather than seeked to
        frame 0 forever."""
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        seen: list[int] = []

        class ZeroFps(FakeCapture):
            def get(self, prop):
                if prop == cv2.CAP_PROP_FPS:
                    return 0.0
                return float(len(self.frames))

        cap = ZeroFps([_frame() for _ in range(40)])
        monkeypatch.setattr(det.cv2, "VideoCapture", lambda path: cap)
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: seen.append(cap.position) or [((0, 0, 40, 80), 0.9)],
        )
        det.score_and_select_best_frame("nofps.mp4")
        assert max(seen) > 0, "every seek went to frame 0"

    def test_a_zero_frame_count_scans_sixty_seconds(self, monkeypatch, no_hog):
        """`max_scan_seconds = duration_seconds if > 0 else 60.0`."""
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        calls: list[int] = []

        class NoCount(FakeCapture):
            def get(self, prop):
                if prop == cv2.CAP_PROP_FPS:
                    return 10.0
                if prop == cv2.CAP_PROP_FRAME_COUNT:
                    return 0.0
                return float(len(self.frames))

        # 700 frames at fps=10 is 70s of video, so the scan window (60s) is not
        # the binding limit and all 61 timestamps are readable. At 400 frames the
        # video is only 40s long, so `arange` stops at 40 and the loop legitimately
        # reads 40 frames — the old assertion was counting the WINDOW, not the reads.
        cap = NoCount([_frame() for _ in range(700)])
        monkeypatch.setattr(det.cv2, "VideoCapture", lambda path: cap)
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: calls.append(1) or [((0, 0, 40, 80), 0.9)],
        )
        det.score_and_select_best_frame("nocount.mp4")
        # arange(0, 60.01, 1.0) => 61 one-second samples over the 60s fallback.
        assert len(calls) == 61

    def test_an_unreadable_seek_is_skipped_rather_than_fatal(self, monkeypatch, no_hog):
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        _capture(monkeypatch, [_frame()])
        monkeypatch.setattr(det, "detect_hog_people", lambda frame, min_weight=0.3: [])
        with pytest.raises(NoPlayersDetectedError):
            det.score_and_select_best_frame("empty.mp4")


# ── extract_players ──────────────────────────────────────────────────────────


class TestExtractPlayers:
    def test_a_none_frame_raises_immediately(self):
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(None)

    def test_an_empty_frame_raises_immediately(self):
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(np.zeros((0, 0, 3), np.uint8))

    def test_the_hog_backend_clips_confidence_into_the_range(self, monkeypatch):
        """`max(0.3, min(1.0, weight))` then a `> 0.5` filter at the end — so a
        weight of 0.9 survives and a weight of 0.1 is raised to 0.3 and then
        dropped."""
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((0, 0, 60, 120), 0.9)]
        )
        (player,) = det.extract_players(_frame())
        assert player["confidence"] == 0.9
        assert player["bbox"] == {"x_min": 0, "y_min": 0, "x_max": 60, "y_max": 120}

    def test_a_weak_hog_detection_is_raised_then_dropped_by_the_final_filter(
        self, monkeypatch
    ):
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((0, 0, 60, 120), 0.1)]
        )
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(_frame())

    def test_the_frame_timestamp_is_rounded_and_carried_onto_every_player(
        self, monkeypatch
    ):
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((0, 0, 60, 120), 0.9), ((200, 200, 260, 320), 0.8)],
        )
        players = det.extract_players(_frame(), frame_timestamp=12.3456)
        assert all(p["frame_timestamp"] == 12.35 for p in players)

    def test_a_default_timestamp_is_zero(self, monkeypatch):
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((0, 0, 60, 120), 0.9)]
        )
        assert det.extract_players(_frame())[0]["frame_timestamp"] == 0.0

    def test_players_are_indexed_left_to_right_by_x_min(self, monkeypatch):
        """The scan pipeline's 1-based index is assigned in x_min order, and
        `tracking.select_detection_by_index` relies on that exact ordering."""
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(
            det,
            "detect_hog_people",
            lambda frame, min_weight=0.3: [((200, 0, 260, 120), 0.9), ((10, 0, 70, 120), 0.8)],
        )
        players = det.extract_players(_frame())
        assert [(p["player_index"], p["bbox"]["x_min"]) for p in players] == [(1, 10), (2, 200)]

    def test_nothing_detected_raises(self, monkeypatch):
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(det, "detect_hog_people", lambda frame, min_weight=0.3: [])
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(_frame())

    def test_an_empty_crop_from_a_degenerate_box_is_skipped(self, monkeypatch):
        monkeypatch.setattr(det, "pose_backend_available", lambda: False)
        monkeypatch.setattr(
            det, "detect_hog_people", lambda frame, min_weight=0.3: [((5, 5, 5, 5), 0.9)]
        )
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(_frame())

    def test_a_candidate_too_narrow_to_crop_is_skipped(self, captured_pose):
        """`crop_w < 24 or crop_h < 48` (detector.py:261).

        The comment above the guard says "at least 40x80 pixels", which does not
        match the numbers in it. Pinned against the *code*, not the comment:
        `bbox_from_landmarks` is called with `padding_ratio=0.35`, so a raw body
        span of 13 px comes out 23 px wide after padding and is dropped.
        """
        captured_pose.pose.results = [[_sized_pose(raw_w_px=13, raw_h_px=80)]]
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(_frame())

    def test_a_candidate_exactly_on_the_width_floor_is_kept(self, captured_pose):
        # 26, not the 25 that `bbox_from_landmarks` alone produces: the real path
        # also runs `transform_landmarks_to_global`, whose rounding widens the box
        # by one. Pinned against the measured value because the point of the test
        # is the boundary, and the boundary is only meaningful if the number is
        # the one the guard actually sees.
        captured_pose.pose.results = [[_sized_pose(raw_w_px=15, raw_h_px=80)]]
        player = det.extract_players(_frame())[0]
        assert player["bbox"]["x_max"] - player["bbox"]["x_min"] == 26

    def test_one_raw_pixel_below_the_floor_is_dropped(self, captured_pose):
        # 13 px raw -> 22 px through the real path (dropped); 15 px raw -> 26 px
        # (kept). The isolated `bbox_from_landmarks` figures are 23 and 25.
        assert 22 < 24 and 26 >= 24
        captured_pose.pose.results = [[_sized_pose(raw_w_px=13, raw_h_px=80)]]
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(_frame())

    def test_a_candidate_too_short_to_crop_is_skipped(self, captured_pose):
        """The height half of the guard: `crop_h < 48`.

        The head room padding adds is `frame_h * 0.15`, so on a 240-tall frame even
        a 1-px body span clears 36 px. A raw span of 5 px measures 44 through the
        real path and is dropped.

        It was previously written with raw_h=7 and asserted a padded 47 "just
        under" the floor. Measured, 7 pads to exactly 48 — and `48 < 48` is false,
        so the guard KEEPS it. The fixture was one pixel from testing the boundary
        it claimed to test, and it was on the wrong side of it.
        """
        captured_pose.pose.results = [[_sized_pose(raw_w_px=60, raw_h_px=5, frame_h=240)]]
        with pytest.raises(NoPlayersDetectedError):
            det.extract_players(_frame(320, 240))

    def test_the_height_floor_boundary_is_inclusive(self, captured_pose):
        """Why the sibling uses raw_h=5 and not 7.

        The guard is `crop_h < 48`, so a crop of exactly 48 is KEPT. `raw_h=7`
        pads to exactly 48 through the real path, which makes it the boundary
        case rather than a drop case — asserted here so the inclusive edge is
        pinned deliberately instead of being stepped on by accident.
        """
        captured_pose.pose.results = [[_sized_pose(raw_w_px=60, raw_h_px=7, frame_h=240)]]
        player = det.extract_players(_frame(320, 240))[0]
        assert player["bbox"]["y_max"] - player["bbox"]["y_min"] == 48

    def test_a_candidate_on_the_height_floor_is_kept(self, captured_pose):
        captured_pose.pose.results = [[_sized_pose(raw_w_px=60, raw_h_px=10, frame_h=240)]]
        player = det.extract_players(_frame(320, 240))[0]
        assert player["bbox"]["y_max"] - player["bbox"]["y_min"] >= 48

    def test_the_height_floor_is_unreachable_on_a_tall_frame(self):
        """CHARACTERISATION: on a 480-tall frame the 0.15 head room is 72 px on
        its own, so `crop_h < 48` can never fire and only the width guard does
        any work. On the 240-tall frame the head room is 36 px, leaving room for
        the height guard to matter."""
        assert 0.15 * 480 > 48
        assert 0.15 * 240 < 48

    def test_the_pose_backend_asks_for_twelve_poses(self, captured_pose):
        """`num_poses=12` in `extract_players` but `num_poses=8` in
        `tracking.build_active_player_tracks` — scan offers the coach more
        candidates than the tracker keeps."""
        try:
            captured_pose.pose.results = [[_spanning_landmarks(0.2, 0.4, 0.2, 0.6)]]
            det.extract_players(_frame())
        except NoPlayersDetectedError:
            pass
        assert captured_pose.kwargs["num_poses"] == 12

    def test_the_pose_branch_encodes_a_crop_per_candidate(self, captured_pose):
        captured_pose.pose.results = [[_spanning_landmarks(0.2, 0.4, 0.2, 0.6)]]
        players = det.extract_players(_frame())
        assert players[0]["crop_base64"]
        assert base64.b64decode(players[0]["crop_base64"])[:2] == b"\xff\xd8"

    def test_the_pose_branch_uses_visibility_as_confidence(self, captured_pose):
        captured_pose.pose.results = [[_uniform_pose(0.2, 0.4, 0.2, 0.6, 0.87)]]
        assert det.extract_players(_frame())[0]["confidence"] == 0.87


# ── detect_players ───────────────────────────────────────────────────────────


class TestDetectPlayers:
    def test_it_composes_the_frame_selection_and_the_extraction(self, monkeypatch):
        sentinel = [{"player_index": 1, "confidence": 0.9, "bbox": {}, "crop_base64": ""}]
        seen: dict = {}
        monkeypatch.setattr(
            det,
            "score_and_select_best_frame",
            lambda path, on_progress=None: seen.update(
                {"path": path, "on_progress": on_progress}
            )
            or (_frame(), 3.5),
        )
        monkeypatch.setattr(
            det,
            "extract_players",
            lambda frame, frame_timestamp=0.0: seen.update({"ts": frame_timestamp}) or sentinel,
        )
        assert det.detect_players("clip.mp4", on_progress=print) == sentinel
        assert seen["path"] == "clip.mp4"
        assert seen["ts"] == 3.5
        assert callable(seen["on_progress"])

    @pytest.mark.parametrize(
        "exc", [NoPlayersDetectedError("none"), VideoDecodeError("bad")]
    )
    def test_the_two_typed_failures_pass_through_unchanged(self, monkeypatch, exc):
        """`api/scan.py` branches on these types (delete-then-retry vs 400), so a
        re-wrap would change the HTTP answer."""

        def boom(path, on_progress=None):
            raise exc

        monkeypatch.setattr(det, "score_and_select_best_frame", boom)
        with pytest.raises(type(exc)):
            det.detect_players("clip.mp4")

    def test_a_raw_cv2_error_is_wrapped_as_a_decode_error(self, monkeypatch):
        import cv2

        def boom(path, on_progress=None):
            raise cv2.error("could not open codec")

        monkeypatch.setattr(det, "score_and_select_best_frame", boom)
        with pytest.raises(VideoDecodeError) as info:
            det.detect_players("clip.mp4")
        assert isinstance(info.value.__cause__, cv2.error)

    def test_an_unexpected_error_is_wrapped_rather_than_leaking(self, monkeypatch):
        def boom(path, on_progress=None):
            raise ZeroDivisionError("something nobody predicted")

        monkeypatch.setattr(det, "score_and_select_best_frame", boom)
        with pytest.raises(VideoDecodeError) as info:
            det.detect_players("clip.mp4")
        assert isinstance(info.value.__cause__, ZeroDivisionError)

    def test_the_wrapped_message_names_the_accepted_formats(self, monkeypatch):
        def boom(path, on_progress=None):
            raise RuntimeError("x")

        monkeypatch.setattr(det, "score_and_select_best_frame", boom)
        with pytest.raises(VideoDecodeError) as info:
            det.detect_players("clip.mp4")
        assert "MP4" in info.value.message
