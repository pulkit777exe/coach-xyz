"""Annotated video: skeleton, per-event banner, measured angles, summary card.

Text is drawn with Pillow onto small sprites that are built once per event and
alpha-blended into a region of each frame, so the per-frame cost is a
skeleton and one blit.
"""

import textwrap
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import geometry as g
from .config import ROOT
from .sports import Pack
from .track import Track
from .video import FFmpegWriter, Media

BONES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24), (23, 25), (25, 27),
         (24, 26), (26, 28), (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32)]
LINE, GOOD, WARN, BAD = (255, 205, 60), (90, 200, 90), (0, 190, 255), (70, 70, 235)
FONTS = ROOT / "assets" / "fonts"


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    for name in (("Montserrat-Bold.ttf", "Montserrat-SemiBold.ttf") if bold else ("Montserrat-Regular.ttf",)):
        p = FONTS / name
        if p.is_file():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size=size)


def _sprite(lines: list[tuple[str, int, bool, tuple]], width: int, pad: int) -> tuple[np.ndarray, np.ndarray]:
    """A dark rounded panel with text lines of (text, size, bold, rgb). Returns BGR image and alpha."""
    fonts = [(_font(s, b), t, c) for t, s, b, c in lines]
    height = pad * 2 + sum(int(f.size * 1.35) for f, _, _ in fonts)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, width - 1, height - 1), radius=pad, fill=(14, 16, 22, 215))
    y = pad
    for f, text, color in fonts:
        d.text((pad, y), text, font=f, fill=color + (255,))
        y += int(f.size * 1.35)
    arr = np.asarray(img)
    return arr[:, :, 2::-1].copy(), arr[:, :, 3:].astype(np.float32) / 255.0


def _blit(frame: np.ndarray, sprite: tuple[np.ndarray, np.ndarray], x: int, y: int) -> None:
    img, alpha = sprite
    h, w = img.shape[:2]
    x, y = max(0, x), max(0, y)
    h, w = min(h, frame.shape[0] - y), min(w, frame.shape[1] - x)
    if h <= 0 or w <= 0:
        return
    roi = frame[y:y + h, x:x + w]
    roi[:] = (img[:h, :w] * alpha[:h, :w] + roi * (1 - alpha[:h, :w])).astype(np.uint8)


def _per_frame(track: Track, fps: float, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Interpolate the track to every video frame. Frames far from any sample get no skeleton."""
    ok = np.flatnonzero(track.valid)
    t = np.arange(n) / fps
    lm = np.zeros((n, 33, 3), np.float32)
    if len(ok) < 2:
        return lm, np.zeros(n, bool)
    for j in range(33):
        for c, col in enumerate((0, 1, 3)):
            lm[:, j, c] = np.interp(t, track.t[ok], track.lm[ok, j, col])
    pos = np.clip(np.searchsorted(track.t[ok], t), 1, len(ok) - 1)
    near = np.minimum(np.abs(t - track.t[ok][pos]), np.abs(t - track.t[ok][pos - 1]))
    return lm, near <= 1.5 / track.rate


def _skeleton(frame: np.ndarray, lm: np.ndarray, thick: int) -> None:
    h, w = frame.shape[:2]
    pts = [(int(x * w), int(y * h)) if v > 0.3 else None for x, y, v in lm]
    for a, b in BONES:
        if pts[a] and pts[b]:
            cv2.line(frame, pts[a], pts[b], LINE, thick, cv2.LINE_AA)
    for p in pts[11:]:
        if p:
            cv2.circle(frame, p, thick + 1, (255, 255, 255), -1, cv2.LINE_AA)


def _label(frame: np.ndarray, text: str, at: tuple[int, int], color, scale: float) -> None:
    x, y = at
    cv2.circle(frame, (x, y), int(6 * scale), color, -1, cv2.LINE_AA)
    pos = (x + int(10 * scale), y - int(8 * scale))
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, (0, 0, 0), max(3, int(4 * scale)), cv2.LINE_AA)
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.6 * scale, (255, 255, 255), max(1, int(2 * scale)), cv2.LINE_AA)


def _banner(e: dict, width: int, k: float) -> tuple[np.ndarray, np.ndarray]:
    kind = e["type"].replace("_", " ").title()
    result = "" if e["result"] == "unknown" else f"   {e['result'].replace('_', ' ').upper()}"
    score = f"Technique {e['score']:.1f}/10" if e["score"] is not None else "Not enough visible to score"
    chars = max(24, int(width / (11 * k)))
    tip = textwrap.wrap(e["feedback"], chars)[:2]
    if len(textwrap.wrap(e["feedback"], chars)) > 2:
        tip[-1] = tip[-1][:-1].rstrip() + "…"
    lines = [(f"#{e['index']}  {kind}{result}", int(22 * k), True, (255, 255, 255)),
             (score, int(17 * k), False, (255, 205, 60))]
    lines += [(t, int(16 * k), False, (225, 225, 230)) for t in tip]
    return _sprite(lines, width, int(14 * k))


def _end_card(last: np.ndarray, result: dict, k: float) -> np.ndarray:
    s = result["summary"]
    img = Image.fromarray(last[:, :, ::-1]).convert("RGB")
    img = Image.blend(img, Image.new("RGB", img.size, (10, 12, 18)), 0.88)
    d = ImageDraw.Draw(img)
    x, y = int(img.width * 0.1), int(img.height * 0.2)
    rows = [("Session summary", 36, True, (255, 255, 255)),
            (f"{s['events']} moments    {s['rating'] or 'Not rated'}    "
             f"{'' if s['average_score'] is None else str(s['average_score']) + '/10'}", 24, False, (255, 205, 60))]
    rows += [(f"•  {f}", 20, False, (225, 225, 230)) for f in s["focus_areas"][:3]]
    for text, size, bold, color in rows:
        size = int(size * k)
        d.text((x, y), text[:90], font=_font(size, bold), fill=color)
        y += int(size * 1.6)
    return np.asarray(img)[:, :, ::-1].copy()


def render(src: str, track: Track, result: dict, pack: Pack, out: str, media: Media, *,
           thumbs_dir: str | None = None, progress=lambda f: None, cancelled=lambda: None) -> list[str]:
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
    ok, first = cap.read()
    if not ok:
        raise ValueError("cannot read source video")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    h, w = first.shape[:2]
    scale = min(1.0, 1080 / h)
    size = (int(w * scale) // 2 * 2, int(h * scale) // 2 * 2)
    k = size[1] / 720
    thick = max(2, int(3 * k))

    lm_f, present = _per_frame(track, fps, total + 1)
    events = result["events"]
    banner_w = int(min(size[0] * 0.92, 760 * k))
    sprites = {e["id"]: _banner(e, banner_w, k) for e in events}
    hud = _sprite([(f"{pack.label}  ·  {len(events)} moments", int(17 * k), True, (255, 255, 255))],
                  int(300 * k), int(10 * k))
    key_frames = {int(round(e["t"] * fps)): e for e in events}
    thumbs: list[str] = []
    last = first
    if thumbs_dir:
        Path(thumbs_dir).mkdir(parents=True, exist_ok=True)

    with FFmpegWriter(out, size[0], size[1], fps, audio_from=src) as writer:
        for i in range(total):
            ok, frame = cap.read()
            if not ok:
                break
            if scale < 1:
                frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
            t = i / fps
            if present[i]:
                _skeleton(frame, lm_f[i], thick)
            active = next((e for e in events if e["t"] - 0.4 <= t < e["t"] - 0.4 + pack.display_s), None)
            if active:
                if present[i]:
                    for m in active["measurements"]:
                        a = g.anchor(m["metric"], active["side"])
                        if m["value"] is not None and a is not None and lm_f[i, a, 2] > 0.3:
                            color = GOOD if m["score"] >= 0.9 else WARN if m["score"] >= 0.5 else BAD
                            _label(frame, f"{m['value']:.0f}°", (int(lm_f[i, a, 0] * size[0]), int(lm_f[i, a, 1] * size[1])),
                                   color, k)
                _blit(frame, sprites[active["id"]], int(24 * k), size[1] - sprites[active["id"]][0].shape[0] - int(28 * k))
            _blit(frame, hud, int(16 * k), int(16 * k))
            if thumbs_dir and i in key_frames:
                e = key_frames[i]
                path = f"{thumbs_dir}/event_{e['index']}.jpg"
                cv2.imwrite(path, cv2.resize(frame, (640, int(640 * size[1] / size[0]))), [cv2.IMWRITE_JPEG_QUALITY, 82])
                thumbs.append(path)
            writer.write(frame)
            last = frame
            if i % 60 == 0:
                cancelled()
                progress(i / total)
        card = _end_card(last, result, k)
        for _ in range(int(fps * 2.5)):
            writer.write(card)
    cap.release()
    return thumbs
