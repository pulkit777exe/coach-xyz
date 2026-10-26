"""A tiny world for end-to-end tests: two coloured "players" on a 640x360 court.

Player A (red) is the athlete. Its right hand rises above the shoulder at
t=2, 5 and 8 seconds. Player B (blue) crosses A's path and raises a hand at
3.5 and 9.5. The fake pose detector reads the picture, so tracking, re-id and
measurement all run on real pixels without MediaPipe.
"""

import re

import cv2
import numpy as np

from core.llm import Unavailable
from core.judge import Rating, Review, Verdict
from core.video import FFmpegWriter

W, H, FPS, SECONDS = 640, 360, 15, 12
RED, BLUE = (30, 30, 200), (200, 70, 30)
A_PULSES, B_PULSES = (2.0, 5.0, 8.0), (3.5, 9.5)
TOP, BOTTOM = 160, 230


def hand_y(t: float, pulses) -> float:
    lift = max((max(0.0, 1 - abs(t - p) / 0.5) for p in pulses), default=0.0)
    return BOTTOM + (TOP - 1.2 * (BOTTOM - TOP) - BOTTOM) * lift


def draw_player(img, cx: int, color, pulses, t: float) -> None:
    cv2.circle(img, (cx, TOP - 35), 18, (150, 170, 200), -1)
    cv2.rectangle(img, (cx - 25, TOP), (cx + 25, BOTTOM), color, -1)
    cv2.rectangle(img, (cx - 25, BOTTOM), (cx + 25, BOTTOM + 100), color, -1)
    cv2.circle(img, (cx + 32, int(hand_y(t, pulses))), 6, (255, 255, 255), -1)


def frame_at(t: float) -> np.ndarray:
    img = np.full((H, W, 3), 60, np.uint8)
    ax, bx = int(120 + 400 * t / SECONDS), int(520 - 400 * t / SECONDS)
    draw_player(img, bx, BLUE, B_PULSES, t)
    draw_player(img, ax, RED, A_PULSES, t)
    return img


def make_video(path: str) -> str:
    with FFmpegWriter(path, W, H, FPS) as w:
        for i in range(FPS * SECONDS):
            w.write(frame_at(i / FPS))
    return path


def _mask(img, color):
    c = np.array(color)
    return cv2.inRange(img, c - 25, c + 25)


class FakePose:
    """Finds the coloured bodies in the image and returns a skeleton for each."""

    def __init__(self):
        self.calls = 0

    def detect(self, bgr, max_people=1):
        self.calls += 1
        h, w = bgr.shape[:2]
        found = []
        for color in (RED, BLUE):
            ys, xs = np.nonzero(_mask(bgr, color))
            if len(xs) < 300:
                continue
            x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
            # the shirt is the top 70 px of the body block
            top, bottom = y1, min(y2, y1 + (BOTTOM - TOP))
            body_h = y2 - y1
            if body_h < 100:
                continue
            cx = (x1 + x2) / 2
            lm = np.zeros((33, 4), np.float32)
            lm[:, :2] = [cx / w, (top + 40) / h]
            lm[:, 3] = 0.1

            def put(i, x, y, v=0.95):
                lm[i] = [x / w, y / h, 0, v]

            put(0, cx, top - 35)
            put(11, x1 + 3, top); put(12, x2 - 3, top)
            put(23, x1 + 5, bottom); put(24, x2 - 5, bottom)
            put(25, x1 + 5, bottom + 50); put(26, x2 - 5, bottom + 50)
            put(27, x1 + 5, y2); put(28, x2 - 5, y2)
            put(31, x1 + 5, y2); put(32, x2 - 5, y2)
            region = bgr[max(0, top - 140):min(h, bottom + 20), max(0, int(cx) - 70):min(w, int(cx) + 70)]
            white = np.argwhere(cv2.inRange(region, (240, 240, 240), (255, 255, 255)))
            wx, wy = (int(cx) - 70 + white[:, 1].mean(), max(0, top - 140) + white[:, 0].mean()) \
                if len(white) else (x2 + 5, bottom)
            put(16, wx, wy); put(15, x1 - 5, bottom)
            put(14, (x2 - 3 + wx) / 2 + 4, (top + wy) / 2 + 6); put(13, x1 - 2, (top + bottom) / 2)
            found.append((len(xs), lm))
        found.sort(key=lambda f: -f[0])
        return [lm for _, lm in found[:max_people]]

    def close(self):
        pass


class FakeModel:
    def __init__(self, fail: bool = False):
        self.calls = 0
        self.fail = fail

    def video_part(self, path, fps):
        return object(), None

    def drop_file(self, name):
        pass

    def structured(self, contents, schema, system=None, video=False):
        self.calls += 1
        if self.fail:
            raise Unavailable("quota exhausted")
        prompt = contents[-1] if isinstance(contents, list) else contents
        count = len(re.findall(r"^#\d+ at about", prompt, re.M))
        events = [Verdict(candidate=n, is_event=True, event_type="three_pointer",
                          result="made" if n % 2 else "missed",
                          ratings=[Rating(criterion="arm_extension", rating="good"),
                                   Rating(criterion="balance", rating="needs_work")],
                          feedback="Keep the elbow under the ball.", confidence=0.9)
                  for n in range(1, count + 1)]
        return "fake-model", Review(sport="basketball", events=events, summary="Solid session.",
                                    strengths=["Release height"], focus_areas=["Balance"],
                                    priority_drill="Form shooting from 1 m.")

    def text(self, prompt, system=None, temperature=0.4):
        return "At 2.0s your release looks good [x:e1]."

    def stream(self, prompt, system=None):
        yield from ("At 2.0s ", "your release.")
