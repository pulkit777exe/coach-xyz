"""Find the moments worth judging from the track alone, without any model.

Each sport names one signal (see `action` in its pack). Peaks of that signal
are candidate moments: a shot is the wrist rising above the shoulder, a swing
or throw is a burst of wrist speed, a kick a burst of ankle speed. Signals are
measured in torso lengths so they do not depend on camera distance.
"""

from dataclasses import dataclass

import numpy as np

from . import geometry as g
from .sports import Pack
from .track import Track


@dataclass
class Candidate:
    i: int  # sample index in the track
    t: float
    strength: float
    side: str  # which arm or leg moved


def torso_px(track: Track) -> float:
    lens = []
    for lm in track.lm[track.valid][::5]:
        n = g.torso_length(lm, track.width, track.height)
        if n > 1:
            lens.append(n)
    return float(np.median(lens)) if lens else max(1.0, 0.3 * track.height)


def _visible(track: Track, idx: int) -> np.ndarray:
    v = track.lm[:, idx, 3]
    return np.nan_to_num(v) >= g.MIN_VISIBILITY


def _speed(track: Track, idx: int, scale: float) -> np.ndarray:
    pos = track.lm[:, idx, :2] * [track.width, track.height]
    out = np.zeros(len(track.t))
    if len(out) < 3:
        return out
    dt = track.t[2:] - track.t[:-2]
    out[1:-1] = np.linalg.norm(pos[2:] - pos[:-2], axis=1) / dt / scale
    out[~_visible(track, idx)] = 0
    return np.nan_to_num(out)


def _rise(track: Track, wrist: int, shoulder: int, scale: float) -> np.ndarray:
    out = (track.lm[:, shoulder, 1] - track.lm[:, wrist, 1]) * track.height / scale
    out[~(_visible(track, wrist) & _visible(track, shoulder))] = 0
    return np.nan_to_num(out)


def signal(track: Track, kind: str) -> tuple[np.ndarray, np.ndarray]:
    """The signal over time and, per sample, which side (0 left, 1 right) produced it."""
    scale = torso_px(track)
    if kind == "wrist_rise":
        pair = (_rise(track, g.L_WRIST, g.L_SHOULDER, scale), _rise(track, g.R_WRIST, g.R_SHOULDER, scale))
    elif kind == "ankle_speed":
        pair = (_speed(track, g.L_ANKLE, scale), _speed(track, g.R_ANKLE, scale))
    else:
        pair = (_speed(track, g.L_WRIST, scale), _speed(track, g.R_WRIST, scale))
    stacked = np.stack(pair)
    return stacked.max(axis=0), stacked.argmax(axis=0)


def peaks(values: np.ndarray, t: np.ndarray, min_gap_s: float, threshold: float) -> list[int]:
    if len(values) < 3:
        return []
    s = values.copy()
    s[1:-1] = 0.25 * values[:-2] + 0.5 * values[1:-1] + 0.25 * values[2:]
    local = [i for i in range(1, len(s) - 1) if s[i] >= threshold and s[i] >= s[i - 1] and s[i] > s[i + 1]]
    chosen: list[int] = []
    for i in sorted(local, key=lambda k: -s[k]):
        if all(abs(t[i] - t[j]) >= min_gap_s for j in chosen):
            chosen.append(i)
    return sorted(chosen)


def candidates(track: Track, pack: Pack, strict: bool = False) -> list[Candidate]:
    """Candidate moments. `strict` keeps only clear peaks, for when no model reviews them."""
    values, side = signal(track, pack.signal)
    positive = values[values > 0]
    if not len(positive):
        return []
    floor = pack.floor * (1.4 if strict else 1.0)
    relative = (0.5 if strict else 0.3) * float(np.percentile(positive, 95))
    found = peaks(values, track.t, pack.min_gap_s, max(floor, relative))
    return [Candidate(i=i, t=float(track.t[i]), strength=float(values[i]),
                      side="right" if side[i] else "left") for i in found]
