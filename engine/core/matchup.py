"""The two players that matter at each event: the one making the action and the
nearest opponent.

We deliberately do not follow one player across the whole video. Instead, every
event opens a short window around the moment, detects everyone in the frame and
pairs the athlete who produced the action with the closest player wearing a
different colour. Each role gets its own short pose track, so the sport's key
metrics can be measured for the ball carrier and the defender alike.
"""

import cv2
import numpy as np

from . import metrics, motion, people
from .motion import Candidate
from .sports import Pack
from .track import Track, clean

SAMPLE_FPS = 8.0
PRE_S = 1.3
POST_S = 0.6
MAX_PEOPLE = 6
MAX_OPPONENT_BODIES = 4.0


def _centre(box) -> np.ndarray:
    return np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], dtype=float)


def _height(box) -> float:
    return max(1.0, float(box[3] - box[1]))


def _pick_opponent(
    found: list[people.Person], primary: people.Person, frame
) -> people.Person | None:
    """Nearest other player, strongly preferring a different shirt colour over a teammate."""
    others = [p for p in found if p is not primary]
    if not others:
        return None
    pc = _centre(primary.box)
    height = _height(primary.box)
    primary_sig = people.signature(frame, primary.box)

    def score(p: people.Person) -> float:
        distance = float(np.linalg.norm(_centre(p.box) - pc)) / height
        look = (
            people.similarity(people.signature(frame, p.box), primary_sig)
            if primary_sig is not None
            else 0.0
        )
        return distance + 2.0 * look

    best = min(others, key=score)
    return (
        best
        if float(np.linalg.norm(_centre(best.box) - pc)) / height <= MAX_OPPONENT_BODIES
        else None
    )


def _window(track: Track, t: float) -> np.ndarray:
    end = min(float(track.t[-1]) if len(track.t) else t + POST_S, t + POST_S)
    times = np.arange(max(0.0, t - PRE_S), max(end, t) + 1e-6, 1.0 / SAMPLE_FPS)
    return times if len(times) else np.array([t])


def _associate(samples: list[list[people.Person]]) -> list[dict]:
    """Link frame detections into short person tracks by box overlap."""
    n = len(samples)
    tracks: list[dict] = []
    for i, found in enumerate(samples):
        free = list(range(len(found)))
        for tr in tracks:
            ref = tr.get("box")
            if ref is None or not free:
                continue
            best = max(free, key=lambda j: people.iou(found[j].box, ref))
            if people.iou(found[best].box, ref) > 0.1:
                tr["persons"][i] = found[best]
                tr["box"] = found[best].box
                free.remove(best)
        for j in free:
            persons = [None] * n
            persons[i] = found[j]
            tracks.append({"persons": persons, "box": found[j].box})
    return tracks


def _peak_signal(tr: Track, pack: Pack, t: float) -> float:
    try:
        values, _ = motion.signal(tr, pack.signal)
    except (IndexError, ValueError):
        return 0.0
    near = np.flatnonzero(np.abs(tr.t - t) <= 0.6)
    if not len(near):
        return 0.0
    return float(np.nan_to_num(values[near]).max())


def _overlap(tr: Track, box) -> float:
    if box is None:
        return 0.0
    ok = np.flatnonzero(tr.valid)
    if not len(ok):
        return 0.0
    return max(people.iou(tr.box[i], box) for i in ok)


def _choose_primary(tracks: list[dict], reference, pack: Pack, t: float) -> dict:
    """The tracked athlete when they are visible, otherwise the strongest action."""
    if reference is not None:
        best_overlap, best = max(
            ((_overlap(tr["track"], reference), tr) for tr in tracks),
            key=lambda pair: pair[0],
        )
        if best_overlap > 0.1:
            return best
    return max(tracks, key=lambda tr: _peak_signal(tr["track"], pack, t))


def _nearest_index(
    persons: list, times: np.ndarray, t: float, max_dt: float = 0.4
) -> int | None:
    ok = [
        i
        for i, p in enumerate(persons)
        if p is not None and abs(float(times[i]) - t) <= max_dt
    ]
    return min(ok, key=lambda i: abs(float(times[i]) - t)) if ok else None


def _nearest_other(
    tracks: list[dict], primary: dict, times: np.ndarray, t: float
) -> dict | None:
    if primary.get("box") is None:
        return None
    centre = _centre(primary["box"])
    best, distance = None, float("inf")
    for tr in tracks:
        if tr is primary:
            continue
        idx = _nearest_index(tr["persons"], times, t)
        if idx is None:
            continue
        d = float(np.linalg.norm(_centre(tr["persons"][idx].box) - centre))
        if d < distance:
            best, distance = tr, d
    return best


def _track(
    times: np.ndarray, people_found: list[people.Person | None], w: int, h: int
) -> Track:
    n = len(times)
    lm = np.full((n, 33, 4), np.nan, np.float32)
    box = np.full((n, 4), np.nan, np.float32)
    conf = np.zeros(n, np.float32)
    for i, p in enumerate(people_found):
        if p is not None:
            lm[i], box[i], conf[i] = p.lm, p.box, p.conf
    return clean(Track(times, lm, box, conf, w, h, SAMPLE_FPS))


def _points(lm: np.ndarray, valid: bool) -> list[list[float]] | None:
    if not valid:
        return None
    pts = np.nan_to_num(lm[:, [0, 1, 3]].copy())
    return np.round(pts, 3).tolist()


def _nearest(tr: Track, t: float, max_dt: float = 0.4) -> int | None:
    ok = np.flatnonzero(tr.valid)
    if not len(ok):
        return None
    idx = int(ok[int(np.abs(tr.t[ok] - t).argmin())])
    return idx if abs(float(tr.t[idx]) - t) <= max_dt else None


def _role(
    pack: Pack,
    tr: Track,
    idx: int | None,
    side: str,
    label: str,
    *,
    tracked: bool | None = None,
) -> dict | None:
    if idx is None:
        return None
    role = {
        "role": label,
        "side": side,
        "confidence": round(float(tr.conf[idx]), 2),
        "metrics": metrics.event_metrics(tr, idx, side, pack),
    }
    if tracked is not None:
        role["tracked"] = tracked
    return role


def _separation(
    primary: Track, p_idx: int | None, opponent: Track, o_idx: int | None
) -> dict | None:
    if p_idx is None or o_idx is None:
        return None
    pbox, obox = primary.box[p_idx], opponent.box[o_idx]
    if not np.isfinite(pbox).all() or not np.isfinite(obox).all():
        return None
    torso = motion.torso_px(primary)
    dx = float(_centre(obox)[0] - _centre(pbox)[0])
    dy = float(_centre(obox)[1] - _centre(pbox)[1])
    return {
        "side": "left" if dx < 0 else "right",
        "distance": round(float(np.hypot(dx, dy)) / torso, 2),
        "dx": round(dx / torso, 2),
        "dy": round(dy / torso, 2),
    }


def analyse(
    path: str,
    detector,
    track: Track,
    cands: list[Candidate],
    pack: Pack,
    progress=lambda f: None,
    cancelled=lambda: None,
) -> dict[int, dict]:
    """Role blocks keyed by candidate sample index. Failures leave that event empty."""
    if not cands:
        return {}
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {}
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or track.width
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or track.height
    out: dict[int, dict] = {}
    try:
        for n, c in enumerate(cands):
            cancelled()
            times = _window(track, c.t)
            event_i = int(np.abs(times - c.t).argmin())
            samples: list[list[people.Person]] = []
            frame_at_event = found_at_event = None
            for i, t in enumerate(times):
                cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
                ok, frame = cap.read()
                found = people.find_people(detector, frame, MAX_PEOPLE) if ok else []
                samples.append(found)
                if i == event_i and ok:
                    frame_at_event, found_at_event = frame, found

            tracks = []
            for tr in _associate(samples):
                tr["track"] = _track(times, tr["persons"], w, h)
                tracks.append(tr)
            if not tracks:
                continue

            reference = track.box_at(c.t)
            primary_tr = _choose_primary(tracks, reference, pack, c.t)
            primary_track = primary_tr["track"]
            p_idx = _nearest(primary_track, c.t)
            primary_is_tracked = bool(
                reference is not None and _overlap(primary_track, reference) > 0.1
            )

            opponent_tr = None
            if found_at_event is not None and frame_at_event is not None:
                primary_person = primary_tr["persons"][event_i]
                if primary_person is not None:
                    opponent_person = _pick_opponent(
                        found_at_event, primary_person, frame_at_event
                    )
                    if opponent_person is not None:
                        opponent_tr = next(
                            (
                                tr
                                for tr in tracks
                                if tr["persons"][event_i] is opponent_person
                            ),
                            None,
                        )
            if opponent_tr is None:
                opponent_tr = _nearest_other(tracks, primary_tr, times, c.t)
            opponent_track = (
                opponent_tr["track"]
                if opponent_tr is not None
                else _track(times, [None] * len(times), w, h)
            )
            o_idx = _nearest(opponent_track, c.t)

            opp_side = "left" if c.side == "right" else "right"
            frames = []
            for i, t in enumerate(times):
                pv = not np.isnan(primary_track.lm[i, 0, 0])
                ov = not np.isnan(opponent_track.lm[i, 0, 0])
                if pv or ov:
                    frames.append(
                        {
                            "t": round(float(t), 3),
                            "primary": _points(primary_track.lm[i], pv),
                            "opponent": _points(opponent_track.lm[i], ov),
                        }
                    )
            out[c.i] = {
                "roles": {"primary": pack.primary_role, "opponent": pack.opponent_role},
                "primary": _role(
                    pack,
                    primary_track,
                    p_idx,
                    c.side,
                    pack.primary_role,
                    tracked=primary_is_tracked,
                ),
                "opponent": _role(
                    pack, opponent_track, o_idx, opp_side, pack.opponent_role
                ),
                "found_opponent": o_idx is not None,
                "separation": _separation(primary_track, p_idx, opponent_track, o_idx),
                "frames": frames,
            }
            progress((n + 1) / len(cands))
    finally:
        cap.release()
    return out
