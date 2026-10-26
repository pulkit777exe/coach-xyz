"""Follow the chosen athlete through the whole video.

The scan gives us a box and a colour signature. Here the video is sampled at
`rate` frames per second; once the athlete is found, pose is run on a crop
around their last position (fast and sharper than full frame). Every few
samples the crop is checked against the signature, and if the match drifts to
someone else the athlete is searched for again across the whole frame.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from . import people
from .errors import EngineError

RECHECK_EVERY = 5
LOST_AFTER = 3


@dataclass
class Lock:
    signature: np.ndarray | None = None
    box: tuple[float, float, float, float] | None = None
    at: float = 0.0

    @classmethod
    def from_player(cls, player: dict | None) -> "Lock":
        if not player:
            return cls()
        b = player.get("bbox")
        sig = player.get("signature")
        return cls(
            signature=np.array(sig, dtype=np.float32) if sig else None,
            box=(b["x_min"], b["y_min"], b["x_max"], b["y_max"]) if b else None,
            at=float(player.get("frame_timestamp", 0.0)),
        )


@dataclass
class Track:
    t: np.ndarray  # (n,) seconds
    lm: np.ndarray  # (n, 33, 4), NaN where the athlete was not found
    box: np.ndarray  # (n, 4) pixels
    conf: np.ndarray  # (n,) mean visibility of the core joints, 0 when missing
    width: int
    height: int
    rate: float

    @property
    def valid(self) -> np.ndarray:
        return ~np.isnan(self.lm[:, 0, 0])

    @property
    def coverage(self) -> float:
        return float(self.valid.mean()) if len(self.t) else 0.0

    def save(self, path: str) -> None:
        np.savez_compressed(path, t=self.t, lm=self.lm, box=self.box, conf=self.conf,
                            size=[self.width, self.height], rate=self.rate)

    @classmethod
    def load(cls, path: str) -> "Track":
        d = np.load(path)
        return cls(d["t"], d["lm"], d["box"], d["conf"], int(d["size"][0]), int(d["size"][1]), float(d["rate"]))

    def box_at(self, t: float):
        ok = np.flatnonzero(self.valid)
        if not len(ok):
            return None
        i = ok[np.abs(self.t[ok] - t).argmin()]
        return self.box[i] if abs(self.t[i] - t) < 1.0 else None

    def overlay(self) -> dict:
        """Compact landmarks for a client that draws its own skeleton."""
        rows = []
        for i in np.flatnonzero(self.valid):
            rows.append({"t": round(float(self.t[i]), 3),
                         "lm": np.round(self.lm[i, :, [0, 1, 3]].T, 3).tolist()})
        return {"width": self.width, "height": self.height, "rate": self.rate, "frames": rows}


def _fill_gaps(a: np.ndarray, valid: np.ndarray, max_gap: int) -> None:
    idx = np.flatnonzero(valid)
    for lo, hi in zip(idx[:-1], idx[1:]):
        if 1 < hi - lo <= max_gap + 1:
            k = np.arange(lo + 1, hi)
            f = ((k - lo) / (hi - lo)).reshape(-1, *[1] * (a.ndim - 1))
            a[k] = a[lo] + (a[hi] - a[lo]) * f


def clean(track: Track, max_gap_s: float = 0.7) -> Track:
    """Bridge short gaps and lightly smooth joint positions (3-tap, visibility weighted)."""
    valid = track.valid
    gap = int(max_gap_s * track.rate)
    lm, box = track.lm.copy(), track.box.copy()
    _fill_gaps(lm, valid, gap)
    _fill_gaps(box, valid, gap)
    conf = track.conf.copy()
    filled = ~np.isnan(lm[:, 0, 0]) & ~valid
    conf[filled] = 0.5 * np.minimum(np.roll(conf, 1), np.roll(conf, -1))[filled]
    xy = lm[:, :, :2]
    smooth = xy.copy()
    for i in range(1, len(xy) - 1):
        if np.isnan(xy[i - 1:i + 2]).any():
            continue
        smooth[i] = 0.25 * xy[i - 1] + 0.5 * xy[i] + 0.25 * xy[i + 1]
    lm[:, :, :2] = smooth
    return Track(track.t, lm, box, conf, track.width, track.height, track.rate)


def _roi(box, w: int, h: int) -> tuple[int, int, int, int]:
    bw, bh = box[2] - box[0], box[3] - box[1]
    return (max(0, int(box[0] - bw * 0.35)), max(0, int(box[1] - bh * 0.2)),
            min(w, int(box[2] + bw * 0.35)), min(h, int(box[3] + bh * 0.2)))


def _follow(detector, frame, box) -> people.Person | None:
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = _roi(box, w, h)
    if x2 - x1 < 32 or y2 - y1 < 32:
        return None
    found = detector.detect(frame[y1:y2, x1:x2], 1)
    if not found:
        return None
    lm = found[0].copy()
    lm[:, 0] = (x1 + lm[:, 0] * (x2 - x1)) / w
    lm[:, 1] = (y1 + lm[:, 1] * (y2 - y1)) / h
    return people._person(lm, w, h)


def _find(detector, frame, t: float, lock: Lock, last) -> people.Person | None:
    found = people.find_people(detector, frame)
    if not found:
        return None
    near_hint = lock.box is not None and abs(t - lock.at) < 1.5
    hint = last if last is not None else (lock.box if near_hint else None)

    def score(p: people.Person) -> float:
        look = people.similarity(people.signature(frame, p.box), lock.signature) if lock.signature is not None else 0.0
        place = people.iou(p.box, hint) if hint is not None else 0.0
        size = (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]) / (frame.shape[0] * frame.shape[1])
        if lock.signature is None and hint is None:
            return size * p.conf
        return 0.65 * look + 0.35 * place + 0.05 * p.conf

    best = max(found, key=score)
    if lock.signature is not None and people.similarity(people.signature(frame, best.box), lock.signature) < 0.2 \
            and (hint is None or people.iou(best.box, hint) < 0.3):
        return None
    return best


def track_athlete(path: str, detector, lock: Lock, *, rate: float = 12, progress=lambda f: None,
                  cancelled=lambda: None) -> Track:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise EngineError("VIDEO_DECODE_FAILED", "Could not read this video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
    stride = max(1, round(fps / rate))
    times, lms, boxes, confs = [], [], [], []
    size = (0, 0)
    box, lost, n, i = None, 0, 0, -1
    nan_lm = np.full((33, 4), np.nan, np.float32)
    try:
        while cap.grab():
            i += 1
            if i % stride:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                continue
            h, w = frame.shape[:2]
            size = (w, h)
            t = i / fps
            found = None
            if box is not None and lost < LOST_AFTER:
                found = _follow(detector, frame, box)
                if found is not None and lock.signature is not None and n % RECHECK_EVERY == 0:
                    if people.similarity(people.signature(frame, found.box), lock.signature) < 0.25:
                        found = None
            if found is None:
                found = _find(detector, frame, t, lock, box)
            if found is not None:
                box, lost = found.box, 0
                if lock.signature is not None and n % RECHECK_EVERY == 0:
                    sig = people.signature(frame, found.box)
                    if sig is not None and people.similarity(sig, lock.signature) > 0.6:
                        lock.signature = 0.9 * lock.signature + 0.1 * sig
                times.append(t)
                lms.append(found.lm)
                boxes.append(found.box)
                confs.append(found.conf)
            else:
                lost += 1
                if lost >= LOST_AFTER:
                    box = None
                times.append(t)
                lms.append(nan_lm)
                boxes.append(np.full(4, np.nan))
                confs.append(0.0)
            n += 1
            if n % 10 == 0:
                cancelled()
                progress(min(1.0, i / total))
    finally:
        cap.release()
    if not times or not any(c > 0 for c in confs):
        raise EngineError("NO_PLAYERS_DETECTED", "The selected player could not be followed in this video.",
                          retryable=True)
    return Track(np.array(times), np.stack(lms), np.stack(boxes), np.array(confs, dtype=np.float32),
                 size[0], size[1], fps / stride)
