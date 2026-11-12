"""Internal tracking used to find the action, not a product-facing tracking overlay.

We follow the action athlete across the clip only so candidate moments and their
measurements are stable. The rendered video and the result focus on short event
windows and on the two players who mattered (see `matchup.py`).
"""

import itertools
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import people
from .errors import EngineError

RECHECK_EVERY = 5
LOST_AFTER = 4
MAX_DRIFT = 0.02


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
    identity_events: list[dict] = field(default_factory=list)

    @property
    def valid(self) -> np.ndarray:
        return ~np.isnan(self.lm[:, 0, 0])

    @property
    def coverage(self) -> float:
        return float(self.valid.mean()) if len(self.t) else 0.0

    @property
    def longest_gap_s(self) -> float:
        if not len(self.t):
            return 0.0
        found = np.flatnonzero(self.valid)
        if len(found) < 2:
            return float(self.t[-1] - self.t[0])
        return float(np.max(np.diff(self.t[found])))

    def save(self, path: str) -> None:
        np.savez_compressed(
            path,
            t=self.t,
            lm=self.lm,
            box=self.box,
            conf=self.conf,
            size=[self.width, self.height],
            rate=self.rate,
        )

    @classmethod
    def load(cls, path: str) -> "Track":
        d = np.load(path)
        return cls(
            d["t"],
            d["lm"],
            d["box"],
            d["conf"],
            int(d["size"][0]),
            int(d["size"][1]),
            float(d["rate"]),
        )

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
            rows.append(
                {
                    "t": round(float(self.t[i]), 3),
                    "lm": np.round(self.lm[i, :, [0, 1, 3]].T, 3).tolist(),
                }
            )
        return {
            "width": self.width,
            "height": self.height,
            "rate": self.rate,
            "frames": rows,
        }


def _fill_gaps(a: np.ndarray, valid: np.ndarray, max_gap: int) -> None:
    idx = np.flatnonzero(valid)
    for lo, hi in itertools.pairwise(idx):
        if 1 < hi - lo <= max_gap + 1:
            k = np.arange(lo + 1, hi)
            f = ((k - lo) / (hi - lo)).reshape(-1, *[1] * (a.ndim - 1))
            a[k] = a[lo] + (a[hi] - a[lo]) * f


def clean(track: Track, max_gap_s: float = 0.8) -> Track:
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
        if np.isnan(xy[i - 1 : i + 2]).any():
            continue
        smooth[i] = 0.25 * xy[i - 1] + 0.5 * xy[i] + 0.25 * xy[i + 1]
    lm[:, :, :2] = smooth
    return Track(track.t, lm, box, conf, track.width, track.height, track.rate)


def _roi(box, w: int, h: int, pad: float = 0.35) -> tuple[int, int, int, int]:
    bw, bh = box[2] - box[0], box[3] - box[1]
    return (
        max(0, int(box[0] - bw * pad)),
        max(0, int(box[1] - bh * pad * 0.6)),
        min(w, int(box[2] + bw * pad)),
        min(h, int(box[3] + bh * pad * 0.6)),
    )


def _map_person(lm, x0, y0, cw, ch, w, h):
    lm = lm.copy()
    lm[:, 0] = (x0 + lm[:, 0] * cw) / w
    lm[:, 1] = (y0 + lm[:, 1] * ch) / h
    return people._person(lm, w, h)


def _follow(detector, frame, box, hint=None) -> people.Person | None:
    """Pose in a crop around the predicted box; keep the person closest to it."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = _roi(box, w, h)
    if x2 - x1 < 24 or y2 - y1 < 24:
        return None
    found = []
    for lm in detector.detect(frame[y1:y2, x1:x2], 3):
        person = _map_person(lm, x1, y1, x2 - x1, y2 - y1, w, h)
        if person is not None:
            found.append(person)
    if not found:
        return None
    previous = hint if hint is not None else box
    return max(
        found, key=lambda p: max(people.iou(p.box, previous), people.iou(p.box, box))
    )


def _emit_f02(
    events: list[dict] | None,
    *,
    t: float,
    message: str,
    similarity: float | None = None,
    threshold: float | None = None,
    reacquired: bool = False,
    episode: int | None = None,
    attempts: int | None = None,
    reason: str | None = None,
) -> None:
    if events is None:
        return
    payload = {
        "code": "F02_IDENTITY_SWITCH",
        "stage": "track",
        "t": round(float(t), 3),
        "message": message,
        "reacquired": reacquired,
    }
    if similarity is not None:
        payload["similarity"] = round(float(similarity), 3)
    if threshold is not None:
        payload["threshold"] = float(threshold)
    if episode is not None:
        payload["episode"] = int(episode)
    if attempts is not None:
        payload["attempts"] = int(attempts)
    if reason is not None:
        payload["reason"] = reason
    # Dedupe/update by episode when provided to avoid noisy repeated events while
    # keeping the latest informative state; otherwise keep first event only.
    if episode is not None:
        for ev in reversed(events):
            if ev.get("code") == "F02_IDENTITY_SWITCH" and ev.get("episode") == episode:
                ev.update(payload)
                return
    elif any(e.get("code") == "F02_IDENTITY_SWITCH" for e in events):
        return
    events.append(payload)


def _find(
    detector,
    frame,
    t: float,
    lock: Lock,
    last,
    *,
    events: list | None = None,
    reacquire_threshold: float = 0.15,
    episode: int | None = None,
    attempt: int | None = None,
) -> people.Person | None:
    found = people.find_people(detector, frame)
    if not found:
        return None
    near_hint = lock.box is not None and abs(t - lock.at) < 1.5
    hint = last if last is not None else (lock.box if near_hint else None)

    def score(p: people.Person) -> float:
        look = (
            people.similarity(people.signature(frame, p.box), lock.signature)
            if lock.signature is not None
            else 0.0
        )
        place = people.iou(p.box, hint) if hint is not None else 0.0
        size = (
            (p.box[2] - p.box[0])
            * (p.box[3] - p.box[1])
            / (frame.shape[0] * frame.shape[1])
        )
        if lock.signature is None and hint is None:
            return size * p.conf
        return 0.65 * look + 0.35 * place + 0.05 * p.conf

    best = max(found, key=score)
    if lock.signature is not None:
        sim = people.similarity(people.signature(frame, best.box), lock.signature)
        if sim < reacquire_threshold and (
            hint is None or people.iou(best.box, hint) < 0.3
        ):
            _emit_f02(
                events,
                t=t,
                similarity=sim,
                threshold=reacquire_threshold,
                reacquired=False,
                episode=episode,
                attempts=attempt,
                reason="low_similarity_reacquire",
                message=(
                    "low-similarity reacquisition while athlete was lost "
                    f"(similarity {sim:.2f} < {reacquire_threshold:.2f} at {t:.2f}s)"
                ),
            )
            return None
    return best


def _dominant(detector, frame, lock: Lock | None = None) -> people.Person | None:
    found = people.find_people(detector, frame)
    if not found:
        return None
    if lock is not None and lock.signature is not None:
        return max(
            found,
            key=lambda p: people.similarity(
                people.signature(frame, p.box), lock.signature
            ),
        )
    return max(
        found,
        key=lambda p: (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]) * max(p.conf, 0.2),
    )


def track_athlete(
    path: str,
    detector,
    lock: Lock,
    *,
    rate: float = 12,
    progress=lambda f: None,
    cancelled=lambda: None,
) -> tuple[Track, list[dict]]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise EngineError("VIDEO_DECODE_FAILED", "Could not read this video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
    stride = max(1, round(fps / rate))
    times, lms, boxes, confs = [], [], [], []
    size = (0, 0)
    box, hint = None, None
    velocity = np.zeros(2)
    lost, primed, n, i = 0, lock.box is not None, 0, -1
    nan_lm = np.full((33, 4), np.nan, np.float32)
    track_events: list[dict] = []
    lost_episode = 0
    lost_search_attempts = 0
    had_low_sim_failure = False
    lost_episode_started_at: float | None = None
    last_t = 0.0
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
            last_t = t
            if not primed:
                first = _dominant(detector, frame, lock)
                if first is not None:
                    box = first.box
                    if lock.signature is None:
                        lock = Lock(
                            signature=people.signature(frame, first.box),
                            box=tuple(first.box),
                            at=t,
                        )
                    primed = True
            found = None
            if box is not None and lost < LOST_AFTER:
                predicted = box + np.tile(velocity, 2)
                found = _follow(detector, frame, predicted, hint=box)
                if (
                    found is not None
                    and lost == 0
                    and people.iou(found.box, box) < MAX_DRIFT
                ):
                    sig = people.signature(frame, found.box)
                    if people.similarity(sig, lock.signature) < 0.25:
                        found = None
                if (
                    found is not None
                    and lock.signature is not None
                    and n % RECHECK_EVERY == 0
                    and people.similarity(
                        people.signature(frame, found.box), lock.signature
                    )
                    < 0.2
                ):
                    found = None
            if found is None:
                emit_episode = None
                emit_attempt = None
                if lost >= LOST_AFTER:
                    if lost_episode == 0 or lost_episode_started_at is None:
                        lost_episode += 1
                        lost_search_attempts = 0
                        had_low_sim_failure = False
                        lost_episode_started_at = t
                    lost_search_attempts += 1
                    emit_episode = lost_episode
                    emit_attempt = lost_search_attempts
                found = _find(
                    detector,
                    frame,
                    t,
                    lock,
                    hint if lost < LOST_AFTER else None,
                    events=track_events if lost >= LOST_AFTER else None,
                    episode=emit_episode,
                    attempt=emit_attempt,
                )
                if (
                    emit_episode is not None
                    and any(
                        ev.get("code") == "F02_IDENTITY_SWITCH"
                        and ev.get("episode") == emit_episode
                        for ev in track_events
                    )
                ):
                    had_low_sim_failure = True
            if found is not None:
                if box is not None:
                    previous = (box[:2] + box[2:]) / 2
                    current = (found.box[:2] + found.box[2:]) / 2
                    velocity = 0.5 * velocity + 0.5 * (current - previous)
                box, hint, lost = found.box, found.box, 0
                lost_episode_started_at = None
                lost_search_attempts = 0
                had_low_sim_failure = False
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
                velocity = velocity * 0.5
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
    if (
        lost >= LOST_AFTER
        and lost_episode_started_at is not None
        and had_low_sim_failure
    ):
        for ev in reversed(track_events):
            if ev.get("code") == "F02_IDENTITY_SWITCH" and ev.get("episode") == lost_episode:
                duration = max(0.0, float(last_t) - float(lost_episode_started_at))
                if duration >= 1.0:
                    ev["message"] = (
                        ev.get("message", "identity reacquisition issue")
                        + f"; athlete remained lost without reacquisition for ~{duration:.1f}s"
                    )
                    ev["lost_duration_s"] = round(duration, 2)
                    ev["reacquired"] = False
                break
    if not times or not any(c > 0 for c in confs):
        raise EngineError(
            "NO_PLAYERS_DETECTED",
            "The selected player could not be followed in this video.",
            retryable=True,
        )
    track = Track(
        np.array(times),
        np.stack(lms),
        np.stack(boxes),
        np.array(confs, dtype=np.float32),
        size[0],
        size[1],
        fps / stride,
        identity_events=track_events,
    )
    track.identity_events = track_events
    return track
