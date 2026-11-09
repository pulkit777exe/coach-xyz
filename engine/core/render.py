"""Annotated video: skeleton, running HUD, per-event metrics and a session card.

Text is drawn with Pillow onto small sprites that are built once per event (or
once per video second for the HUD) and alpha-blended into a region of each
frame, so the per-frame cost stays a skeleton and a couple of blits.
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

BONES = [
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (11, 23),
    (12, 24),
    (23, 24),
    (23, 25),
    (25, 27),
    (24, 26),
    (26, 28),
    (27, 29),
    (29, 31),
    (27, 31),
    (28, 30),
    (30, 32),
    (28, 32),
]
LINE, GOOD, WARN, BAD = (255, 205, 60), (90, 200, 90), (0, 190, 255), (70, 70, 235)
DEFENDER = (60, 140, 255)
ACCENT = (60, 205, 255)  # BGR amber used by the progress bar
MUTED = (200, 200, 210)
FONTS = ROOT / "assets" / "fonts"


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    for name in (
        ("Montserrat-Bold.ttf", "Montserrat-SemiBold.ttf")
        if bold
        else ("Montserrat-Regular.ttf",)
    ):
        p = FONTS / name
        if p.is_file():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size=size)


def _sprite(
    lines: list[tuple[str, int, bool, tuple]], width: int, pad: int
) -> tuple[np.ndarray, np.ndarray]:
    """A dark rounded panel with text lines of (text, size, bold, rgb). Returns BGR image and alpha."""
    fonts = [(_font(s, b), t, c) for t, s, b, c in lines]
    height = pad * 2 + sum(int(f.size * 1.35) for f, _, _ in fonts)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        (0, 0, width - 1, height - 1), radius=pad, fill=(14, 16, 22, 215)
    )
    y = pad
    for f, text, color in fonts:
        d.text((pad, y), text, font=f, fill=color + (255,))
        y += int(f.size * 1.35)
    arr = np.asarray(img)
    return arr[:, :, 2::-1].copy(), arr[:, :, 3:].astype(np.float32) / 255.0


def _blit(
    frame: np.ndarray, sprite: tuple[np.ndarray, np.ndarray], x: int, y: int
) -> None:
    img, alpha = sprite
    h, w = img.shape[:2]
    x, y = max(0, x), max(0, y)
    h, w = min(h, frame.shape[0] - y), min(w, frame.shape[1] - x)
    if h <= 0 or w <= 0:
        return
    roi = frame[y : y + h, x : x + w]
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


def _skeleton(frame: np.ndarray, lm: np.ndarray, thick: int, color=LINE) -> None:
    h, w = frame.shape[:2]
    pts = [(int(x * w), int(y * h)) if v > 0.3 else None for x, y, v in lm]
    for a, b in BONES:
        if pts[a] and pts[b]:
            cv2.line(frame, pts[a], pts[b], color, thick, cv2.LINE_AA)
    for p in pts[11:]:
        if p:
            cv2.circle(frame, p, thick + 1, (255, 255, 255), -1, cv2.LINE_AA)


def _label(
    frame: np.ndarray, text: str, at: tuple[int, int], color, scale: float
) -> None:
    x, y = at
    cv2.circle(frame, (x, y), int(6 * scale), color, -1, cv2.LINE_AA)
    pos = (x + int(10 * scale), y - int(8 * scale))
    cv2.putText(
        frame,
        text,
        pos,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6 * scale,
        (0, 0, 0),
        max(3, int(4 * scale)),
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        text,
        pos,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6 * scale,
        (255, 255, 255),
        max(1, int(2 * scale)),
        cv2.LINE_AA,
    )


def _fit(text: str, chars: int) -> str:
    return text if len(text) <= chars else text[: max(1, chars - 3)].rstrip() + "..."


def _number(value: float) -> str:
    return f"{value:.0f}" if abs(value) >= 10 else f"{value:.1f}"


def _metric_color(metric: dict) -> tuple:
    score = metric.get("score")
    if score is None:
        return MUTED
    return (
        (90, 200, 90)
        if score >= 0.85
        else (255, 190, 0)
        if score >= 0.5
        else (235, 70, 70)
    )


def _clock(seconds: float) -> str:
    m, s = divmod(max(0, int(seconds)), 60)
    return f"{m:02d}:{s:02d}"


def _hud(
    pack: Pack, events: list[dict], t: float, active: int | None, width: int, k: float
) -> tuple:
    """Sport, clock, moment counter and average technique score."""
    s = None
    scored = [e["score"] for e in events if e["score"] is not None]
    if scored:
        s = sum(scored) / len(scored)
    parts = [pack.label, _clock(t)]
    if active is not None and events:
        parts.append(f"moment {active + 1}/{len(events)}")
    elif events:
        parts.append(f"{len(events)} moments")
    parts.append(f"avg {s:.1f}/10" if s is not None else "not scored")
    lines = [("  |  ".join(parts), int(17 * k), True, (255, 255, 255))]
    return _sprite(lines, width, int(10 * k))


def _banner(e: dict, width: int, k: float) -> tuple[np.ndarray, np.ndarray]:
    """Event title, technique score, the sport's key metrics for both players and one coaching line."""
    kind = e["type"].replace("_", " ").title()
    result = (
        ""
        if e["result"] == "unknown"
        else f"   {e['result'].replace('_', ' ').upper()}"
    )
    score = (
        f"Technique {e['score']:.1f}/10"
        if e["score"] is not None
        else "Not enough visible to score"
    )
    chars = max(24, int(width / (11 * k)))
    lines = [
        (
            _fit(f"#{e['index']}  {kind}{result}", chars),
            int(22 * k),
            True,
            (255, 255, 255),
        ),
        (score, int(17 * k), False, (255, 205, 60)),
    ]

    match = e.get("matchup") or {}
    roles = match.get("roles") or {}
    primary = match.get("primary") or {}
    shown = [
        m
        for m in (primary.get("metrics") or e.get("metrics") or [])
        if m.get("value") is not None
    ][:2]
    for m in shown:
        value = f"{_number(float(m['value']))}{m.get('unit') or ''}"
        note = "" if m.get("score") is None else f"  ({m['score']:.0%})"
        prefix = f"{roles.get('primary')}: " if roles.get("primary") else ""
        lines.append(
            (
                _fit(f"{prefix}{m['label']} {value}{note}", chars),
                int(16 * k),
                False,
                _metric_color(m),
            )
        )

    opponent = match.get("opponent") or {}
    opp_metrics = [
        m for m in opponent.get("metrics") or [] if m.get("value") is not None
    ][:2]
    if opp_metrics:
        values = " | ".join(
            f"{m['label']} {_number(float(m['value']))}{m.get('unit') or ''}"
            for m in opp_metrics
        )
        lines.append(
            (
                _fit(f"{opponent.get('role', 'Opponent')}: {values}", chars),
                int(15 * k),
                False,
                (150, 205, 255),
            )
        )
    separation = match.get("separation")
    if separation and separation.get("distance") is not None:
        lines.append(
            (
                _fit(
                    f"Distance {separation['distance']:.1f} torso to the {separation['side']}",
                    chars,
                ),
                int(15 * k),
                False,
                (225, 225, 230),
            )
        )

    tip = textwrap.wrap(e["feedback"], chars)[:2]
    if len(textwrap.wrap(e["feedback"], chars)) > 2:
        tip[-1] = tip[-1][: max(1, chars - 3)].rstrip() + "..."
    lines += [(_fit(t, chars), int(15 * k), False, (225, 225, 230)) for t in tip]
    return _sprite(lines, width, int(14 * k))


def _end_card(last: np.ndarray, result: dict, pack: Pack, k: float) -> np.ndarray:
    s = result["summary"]
    img = Image.fromarray(last[:, :, ::-1]).convert("RGB")
    img = Image.blend(img, Image.new("RGB", img.size, (10, 12, 18)), 0.9)
    d = ImageDraw.Draw(img)
    x, y = int(img.width * 0.08), int(img.height * 0.12)
    chars = max(30, int(img.width / (10.5 * k)))
    summary = f"{s['events']} moments"
    if s.get("made") or s.get("missed"):
        summary += f"   {s.get('made', 0)} made / {s.get('missed', 0)} missed"
    average = (
        "" if s["average_score"] is None else f"   {s['average_score']}/10 average"
    )
    rows = [
        ("Session summary", 38, True, (255, 255, 255)),
        (_fit(summary, chars), 24, False, (255, 205, 60)),
        (
            _fit(f"{s['rating'] or 'Not rated'}{average}", chars),
            22,
            False,
            (255, 255, 255),
        ),
    ]
    if s.get("confidence") is not None:
        rows.append((f"Measurement confidence {s['confidence']:.0%}", 17, False, MUTED))
    if s.get("success_rate") is not None:
        rows.append((f"Success rate {s['success_rate']:.0f}%", 17, False, MUTED))
    metrics = [
        m
        for m in result.get("session_metrics") or []
        if m.get("kind") in ("metric", "matchup")
    ][:5]
    for m in metrics:
        best = "" if m.get("best") is None else f"   best {_number(float(m['best']))}"
        rows.append(
            (
                _fit(
                    f"-  {m['label']}: {_number(float(m['value']))}{m['unit']}{best}",
                    chars,
                ),
                18,
                False,
                (225, 225, 230),
            )
        )
    if s["focus_areas"]:
        rows.append(("Focus", 19, True, (255, 205, 60)))
        rows += [
            (_fit(f"-  {f}", chars), 17, False, (225, 225, 230))
            for f in s["focus_areas"][:3]
        ]
    rows.append((f"CoachXYZ  |  {pack.label} pack v{pack.version}", 15, False, MUTED))
    for text, size, bold, color in rows:
        size = int(size * k)
        d.text((x, y), text, font=_font(size, bold), fill=color)
        y += int(size * 1.5)
    return np.asarray(img)[:, :, ::-1].copy()


def _matchup_frame(e: dict, t: float) -> dict | None:
    frames = (e.get("matchup") or {}).get("frames") or []
    if not frames:
        return None
    best = min(frames, key=lambda f: abs(float(f["t"]) - t))
    return best if abs(float(best["t"]) - t) <= 0.3 else None


def _role_tag(frame: np.ndarray, lm, text: str, color, k: float) -> None:
    if lm is None or len(lm) < 13:
        return
    h, w = frame.shape[:2]
    head = lm[0] if lm[0][2] > 0.3 else lm[11]
    if head[2] <= 0.3:
        return
    x, y = (
        int(head[0] * w) - int(28 * k),
        max(int(14 * k), int(head[1] * h) - int(16 * k)),
    )
    cv2.putText(
        frame,
        text,
        (x, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5 * max(k, 0.7),
        (0, 0, 0),
        max(3, int(4 * k)),
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        text,
        (x, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5 * max(k, 0.7),
        color,
        max(1, int(2 * k)),
        cv2.LINE_AA,
    )


def render(
    src: str,
    track: Track,
    result: dict,
    pack: Pack,
    out: str,
    media: Media,
    *,
    thumbs_dir: str | None = None,
    progress=lambda f: None,
    cancelled=lambda: None,
) -> list[str]:
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
    banner_w = int(min(size[0] * 0.94, 780 * k))
    sprites = {e["id"]: _banner(e, banner_w, k) for e in events}
    hud_w = int(min(size[0] - 32 * k, 660 * k))
    hud_key: tuple[int, int] | None = None
    hud = None
    key_frames = {round(e["t"] * fps): e for e in events}
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
            active = next(
                (
                    n
                    for n, e in enumerate(events)
                    if e["t"] - 0.4 <= t < e["t"] - 0.4 + pack.display_s
                ),
                None,
            )
            if active is not None:
                e = events[active]
                match = e.get("matchup") or {}
                mframe = _matchup_frame(e, t)
                primary_lm = (
                    np.asarray(mframe["primary"], np.float32)
                    if mframe and mframe.get("primary")
                    else None
                )
                opponent_lm = (
                    np.asarray(mframe["opponent"], np.float32)
                    if mframe and mframe.get("opponent")
                    else None
                )
                if primary_lm is not None:
                    _skeleton(frame, primary_lm, thick, LINE)
                    _role_tag(
                        frame,
                        primary_lm,
                        match.get("roles", {}).get("primary", ""),
                        LINE,
                        k,
                    )
                elif present[i] and not match:
                    _skeleton(frame, lm_f[i], thick, LINE)
                if opponent_lm is not None:
                    _skeleton(frame, opponent_lm, thick, DEFENDER)
                    _role_tag(
                        frame,
                        opponent_lm,
                        match.get("roles", {}).get("opponent", ""),
                        DEFENDER,
                        k,
                    )
                pose = (
                    primary_lm
                    if primary_lm is not None
                    else (lm_f[i] if not match else None)
                )
                if pose is not None:
                    for m in e["measurements"]:
                        a = g.anchor(m["metric"], e["side"])
                        if (
                            m["value"] is not None
                            and m["score"] is not None
                            and a is not None
                            and pose[a, 2] > 0.3
                        ):
                            color = (
                                GOOD
                                if m["score"] >= 0.85
                                else WARN
                                if m["score"] >= 0.5
                                else BAD
                            )
                            unit = "°" if "angle" in m["metric"] else ""
                            _label(
                                frame,
                                f"{m['value']:.0f}{unit}",
                                (int(pose[a, 0] * size[0]), int(pose[a, 1] * size[1])),
                                color,
                                k,
                            )
                _blit(
                    frame,
                    sprites[e["id"]],
                    int(24 * k),
                    size[1] - sprites[e["id"]][0].shape[0] - int(26 * k),
                )
            key = (int(t), -1 if active is None else active)
            if key != hud_key:
                hud = _hud(pack, events, t, active, hud_w, k)
                hud_key = key
            _blit(frame, hud, int(16 * k), int(16 * k))
            fill = int(size[0] * min(1.0, t * fps / total)) if total else 0
            bar = max(3, int(4 * k))
            cv2.rectangle(frame, (0, 0), (size[0], bar), (40, 42, 50), -1)
            cv2.rectangle(frame, (0, 0), (fill, bar), ACCENT, -1)
            if thumbs_dir and i in key_frames:
                e = key_frames[i]
                path = f"{thumbs_dir}/event_{e['index']}.jpg"
                cv2.imwrite(
                    path,
                    cv2.resize(frame, (640, int(640 * size[1] / size[0]))),
                    [cv2.IMWRITE_JPEG_QUALITY, 82],
                )
                thumbs.append(path)
            writer.write(frame)
            last = frame
            if i % 60 == 0:
                cancelled()
                progress(i / total)
        card = _end_card(last, result, pack, k)
        for _ in range(int(fps * 2.5)):
            writer.write(card)
    cap.release()
    return thumbs
