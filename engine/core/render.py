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
    size = max(8, int(size))
    for name in (
        ("Montserrat-Bold.ttf", "Montserrat-SemiBold.ttf")
        if bold
        else ("Montserrat-Regular.ttf",)
    ):
        p = FONTS / name
        if p.is_file():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _text_len(font: ImageFont.ImageFont, text: str) -> float:
    text = str(text)
    if hasattr(font, "getlength"):
        try:
            return float(font.getlength(text))
        except Exception:
            pass
    try:
        bbox = font.getbbox(text)
        return float(bbox[2] - bbox[0])
    except Exception:
        return float(len(text) * max(8, int(getattr(font, "size", 12) or 12)) * 0.55)


def _wrap_pixels(text: str, font: ImageFont.ImageFont, max_w: float) -> list[str]:
    if not text:
        return [""]
    words = text.split()
    if not words:
        return [text]
    lines: list[str] = []
    cur = words[0]
    for word in words[1:]:
        trial = f"{cur} {word}"
        if _text_len(font, trial) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    out: list[str] = []
    for line in lines:
        if _text_len(font, line) <= max_w or max_w <= 1:
            out.append(line)
            continue
        chunk = ""
        for ch in line:
            trial = chunk + ch
            if chunk and _text_len(font, trial) > max_w:
                out.append(chunk)
                chunk = ch
            else:
                chunk = trial
        if chunk:
            out.append(chunk)
    return out or [text]


def _cap_drawn_lines(
    drawn: list[tuple[ImageFont.ImageFont, str, tuple, int]],
    max_h: int,
    pad: int,
    inner: float,
) -> list[tuple[ImageFont.ImageFont, str, tuple, int]]:
    if max_h <= 0 or not drawn:
        return drawn
    avail = max(1, max_h - pad * 2)
    kept: list[tuple[ImageFont.ImageFont, str, tuple, int]] = []
    used = 0
    for i, (f, text, color, lh) in enumerate(drawn):
        lh = max(1, int(lh))
        remaining_after = len(drawn) - i - 1
        if used + lh <= avail:
            kept.append((f, text, color, lh))
            used += lh
            continue
        room = avail - used
        if room >= max(8, lh // 2):
            kept.append((f, _fit_px(text, f, inner), color, min(lh, room)))
        elif kept:
            pf, pt, pc, plh = kept[-1]
            marker = " ..." if remaining_after >= 0 else ""
            kept[-1] = (pf, _fit_px((pt.rstrip() + marker).strip(), pf, inner), pc, plh)
        else:
            kept.append((f, _fit_px(text, f, inner), color, min(lh, avail)))
        break
    return kept or [(drawn[0][0], _fit_px(drawn[0][1], drawn[0][0], inner), drawn[0][2], min(max(1, int(drawn[0][3])), avail))]


def _sprite(
    lines: list[tuple[str, int, bool, tuple]],
    width: int,
    pad: int,
    *,
    wrap: bool = True,
    max_h: int | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """A dark rounded panel with text lines of (text, size, bold, rgb). Returns BGR image and alpha."""
    inner = max(8.0, float(width - pad * 2))
    fonts = [(_font(s, b), t, c, int(s * 1.35)) for t, s, b, c in lines]
    drawn: list[tuple[ImageFont.ImageFont, str, tuple, int]] = []
    for f, text, color, lh in fonts:
        parts = _wrap_pixels(text, f, inner) if wrap else [text]
        drawn.extend((f, part, color, lh) for part in parts)
    if max_h is not None:
        drawn = _cap_drawn_lines(drawn, int(max_h), pad, inner)
    height = pad * 2 + sum(lh for _, _, _, lh in drawn)
    img = Image.new("RGBA", (width, max(height, pad * 2 + 1)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        (0, 0, width - 1, max(height, 1) - 1), radius=pad, fill=(14, 16, 22, 215)
    )
    y = pad
    for f, text, color, lh in drawn:
        d.text((pad, y), text, font=f, fill=color + (255,))
        y += lh
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


def _fit_px(text: str, font: ImageFont.ImageFont, max_w: float) -> str:
    if _text_len(font, text) <= max_w or max_w <= 1:
        return text
    ell = "..."
    ell_w = _text_len(font, ell)
    out = text
    while out and _text_len(font, out) + ell_w > max_w:
        out = out[:-1]
    return (out.rstrip() + ell) if out else ell


def _number(value: float) -> str:
    return f"{value:.0f}" if abs(value) >= 10 else f"{value:.1f}"


def _fmt(value: float, unit: str | None = None) -> str:
    unit = (unit or "").strip()
    if not unit:
        return _number(value)
    sep = "" if unit[0] in "°%/" else " "
    return f"{_number(value)}{sep}{unit}"


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
    text = "  |  ".join(parts)
    pad = max(4, int(10 * k))
    inner = max(16.0, float(width - pad * 2))
    size = max(10, int(17 * k))
    font = _font(size, True)
    if _text_len(font, text) > inner:
        compact = [parts[0], parts[1], parts[-1]]
        text = "  |  ".join(compact)
    if _text_len(font, text) > inner:
        text = "  |  ".join([parts[0], parts[-1]])
    if _text_len(font, text) > inner and events:
        text = "  |  ".join([pack.label[:12], parts[-1]])
    if _text_len(font, text) > inner:
        text = _fit_px(text, font, inner)
    lines = [(text, size, True, (255, 255, 255))]
    # Cap HUD height for extreme frames so it cannot cover the whole view.
    max_h = max(size + pad * 2, int(44 * max(k, 0.45)))
    return _sprite(lines, width, pad, wrap=False, max_h=max_h)


def _banner(
    e: dict, width: int, k: float, *, max_h: int | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """Event title, technique score, honesty/confidence cues, key metrics and coaching line."""
    kind = str(e.get("type") or "moment").replace("_", " ").title()
    ev_result = e.get("result")
    result = (
        ""
        if ev_result in (None, "unknown")
        else f"   {str(ev_result).replace('_', ' ').upper()}"
    )
    score_val = e.get("score")
    try:
        score_f = float(score_val) if score_val is not None else None
    except Exception:
        score_f = None
    if score_f is not None and not np.isfinite(score_f):
        score_f = None
    score = (
        f"Technique {score_f:.1f}/10"
        if score_f is not None
        else "Not enough visible to score"
    )
    pad = max(4, int(12 * k))
    inner = max(12.0, float(width - pad * 2))
    title = f"#{e.get('index', '?')}  {kind}{result}"
    state = e.get("event_state") or ("confirmed" if e.get("confirmed") else "uncertain")
    dense = (max_h is not None and max_h < 170 * max(k, 0.4)) or width < 260
    extreme = (max_h is not None and max_h < 110 * max(k, 0.35)) or width < 150
    honesty_lines = []
    if state != "confirmed":
        label = "Unreviewed candidate" if state == "candidate" else str(state).replace("_", " ").title()
        honesty_lines.append(
            (_fit_px(f"Review: {label}", _font(max(9, int(14 * k)), True), inner), max(9, int(14 * k)), True, (255, 190, 0))
        )
    conf = e.get("confidence")
    conf_kind = e.get("confidence_kind")
    if conf is not None:
        try:
            conf_f = float(conf)
        except Exception:
            conf_f = None
        if conf_f is not None and np.isfinite(conf_f):
            c_label = "Confidence"
            if conf_kind == "pose":
                c_label = "Pose confidence"
            elif conf_kind == "tracking":
                c_label = "Tracking confidence"
            elif conf_kind == "event":
                c_label = "Event confidence"
            honesty_lines.append(
                (_fit_px(f"{c_label} {conf_f:.0%}", _font(max(8, int(13 * k)), False), inner), max(8, int(13 * k)), False, MUTED)
            )
    quality = e.get("quality") if isinstance(e.get("quality"), dict) else {}
    if quality.get("needs_review"):
        honesty_lines.append(("Needs review", max(8, int(13 * k)), False, (255, 190, 0)))

    title_size = max(10 if extreme else 11, int((18 if extreme else 22) * k))
    score_size = max(9 if extreme else 10, int((14 if extreme else 17) * k))
    lines = [
        (_fit_px(title, _font(title_size, True), inner), title_size, True, (255, 255, 255)),
        (_fit_px(score, _font(score_size, False), inner), score_size, False, (255, 205, 60)),
        *honesty_lines,
    ]

    detail_budget = 0 if (extreme and honesty_lines) else (1 if dense else 99)
    match = e.get("matchup") if isinstance(e.get("matchup"), dict) else {}
    roles = match.get("roles") if isinstance(match.get("roles"), dict) else {}
    primary = match.get("primary") if isinstance(match.get("primary"), dict) else {}
    raw_metrics = primary.get("metrics") if isinstance(primary.get("metrics"), list) else e.get("metrics")
    metrics_list = raw_metrics if isinstance(raw_metrics, list) else []
    shown = []
    for m in metrics_list:
        if not isinstance(m, dict):
            continue
        if m.get("value") is None:
            continue
        try:
            if not np.isfinite(float(m.get("value"))):
                continue
        except Exception:
            continue
        shown.append(m)
    shown = shown[: (0 if detail_budget == 0 else 1 if dense else 2)]
    for m in shown:
        try:
            value = _fmt(float(m["value"]), m.get("unit"))
        except Exception:
            continue
        m_score = m.get("score")
        try:
            m_score_f = float(m_score) if m_score is not None else None
        except Exception:
            m_score_f = None
        note = "" if m_score_f is None or not np.isfinite(m_score_f) else f" ({m_score_f:.0%})"
        prefix = f"{roles.get('primary')}: " if roles.get("primary") else ""
        label = m.get("label") or m.get("key") or "Metric"
        txt = _fit_px(f"{prefix}{label} {value}{note}", _font(max(8, int(15 * k)), False), inner)
        lines.append((txt, max(8, int(15 * k)), False, _metric_color(m)))
        detail_budget -= 1

    if not dense and detail_budget > 0:
        opponent = match.get("opponent") if isinstance(match.get("opponent"), dict) else {}
        opp_raw = opponent.get("metrics") if isinstance(opponent.get("metrics"), list) else []
        opp_metrics = []
        for m in opp_raw:
            if not isinstance(m, dict) or m.get("value") is None:
                continue
            try:
                if not np.isfinite(float(m.get("value"))):
                    continue
            except Exception:
                continue
            opp_metrics.append(m)
        opp_metrics = opp_metrics[:1]
        if opp_metrics:
            values = " | ".join(
                f"{m.get('label') or m.get('key') or 'Metric'} {_fmt(float(m['value']), m.get('unit'))}"
                for m in opp_metrics
            )
            opp_role = opponent.get("role") or "Opponent"
            lines.append(
                (_fit_px(f"{opp_role}: {values}", _font(max(8, int(14 * k)), False), inner), max(8, int(14 * k)), False, (150, 205, 255))
            )
        separation = match.get("separation") if isinstance(match.get("separation"), dict) else None
        if separation and separation.get("distance") is not None:
            try:
                dist = float(separation.get("distance"))
                if np.isfinite(dist):
                    lines.append(
                        (
                            _fit_px(
                                f"Distance {_fmt(dist, 'torso')} to the {separation.get('side', '')}".strip(),
                                _font(max(8, int(14 * k)), False),
                                inner,
                            ),
                            max(8, int(14 * k)),
                            False,
                            (225, 225, 230),
                        )
                    )
            except Exception:
                pass

    feedback = str(e.get("feedback") or "").strip()
    if feedback and not (extreme and honesty_lines):
        tip_size = max(8, int(14 * k))
        tip_font = _font(tip_size, False)
        max_tip_lines = 0 if (dense and honesty_lines) else (1 if dense else 3)
        if max_tip_lines > 0:
            tip_wrapped = _wrap_pixels(feedback, tip_font, inner)
            tip_lines = tip_wrapped[:max_tip_lines]
            if len(tip_wrapped) > max_tip_lines and tip_lines:
                tip_lines[-1] = _fit_px(tip_lines[-1], tip_font, inner)
            lines += [(t, tip_size, False, (225, 225, 230)) for t in tip_lines]

    # On pathological density, if capping would drop honesty cues, keep a compact
    # honesty-first layout.
    if max_h is not None and honesty_lines and max_h < 150 * max(k, 0.35):
        compact = [lines[0]] + honesty_lines[:2]
        return _sprite(compact, width, pad, max_h=max_h)
    return _sprite(lines, width, pad, max_h=max_h)


def _draw_wrapped(
    d: ImageDraw.ImageDraw,
    text: str,
    x: int,
    y: int,
    size: int,
    bold: bool,
    color: tuple,
    max_w: float,
    *,
    bottom: int | None = None,
    last: bool = False,
) -> int:
    size = max(8, int(size))
    font = _font(size, bold)
    wrapped = _wrap_pixels(str(text), font, max(8.0, float(max_w)))
    step = max(size + 2, int(size * 1.45))
    limit = bottom if bottom is not None else 10**9
    for i, line in enumerate(wrapped):
        remaining = len(wrapped) - i - 1
        if y >= limit:
            return limit + 1
        if y + step > limit:
            d.text((x, y), _fit_px(line, font, max_w), font=font, fill=color)
            return limit + 1
        # reserve space for an ellipsis line only if this isn't the last logical row
        if not last and remaining > 0 and y + step * 2 > limit:
            d.text((x, y), _fit_px(line, font, max_w), font=font, fill=color)
            return limit + 1
        d.text((x, y), _fit_px(line, font, max_w), font=font, fill=color)
        y += step
    return y


def _end_card(last: np.ndarray, result: dict, pack: Pack, k: float) -> np.ndarray:
    s = result.get("summary") or {}
    if not isinstance(s, dict):
        s = {}
    img = Image.fromarray(last[:, :, ::-1]).convert("RGB")
    img = Image.blend(img, Image.new("RGB", img.size, (10, 12, 18)), 0.9)
    d = ImageDraw.Draw(img)
    x = int(img.width * 0.06) if img.width < 260 else int(img.width * 0.08)
    y = int(img.height * 0.08) if img.height < 260 else int(img.height * 0.12)
    max_w = float(max(24, img.width - x - x))
    bottom = img.height - max(10, int(img.height * 0.06)) if img.height < 260 else img.height - int(img.height * 0.08)
    summary = f"{s.get('events', 0)} moments"
    if s.get("made") or s.get("missed"):
        summary += f"   {s.get('made', 0)} made / {s.get('missed', 0)} missed"
    avg = s.get("average_score")
    average = ""
    try:
        if avg is not None and np.isfinite(float(avg)):
            average = f"   {float(avg)}/10 average"
    except Exception:
        average = ""
    rows = [
        ("Session summary", 38, True, (255, 255, 255)),
        (summary, 24, False, (255, 205, 60)),
        (f"{s.get('rating') or 'Not rated'}{average}", 22, False, (255, 255, 255)),
    ]
    # Honesty/confidence first; detailed metrics/focus follow and may be truncated on dense frames.
    conf_kind = s.get("confidence_kind")
    conf = s.get("confidence")
    pose = s.get("pose_confidence")
    if conf is not None:
        try:
            conf_f = float(conf)
            if np.isfinite(conf_f):
                label = "Pose confidence"
                if conf_kind == "event":
                    label = "Event confidence"
                elif conf_kind == "tracking":
                    label = "Tracking confidence"
                elif s.get("events", 0) == 0 or s.get("average_score") is None:
                    label = "Tracking confidence"
                rows.append((f"{label} {conf_f:.0%}", 17, False, MUTED))
                if pose is not None and conf_kind == "event":
                    try:
                        pose_f = float(pose)
                        if np.isfinite(pose_f) and abs(pose_f - conf_f) > 0.01:
                            rows.append((f"Pose confidence {pose_f:.0%}", 16, False, MUTED))
                    except Exception:
                        pass
        except Exception:
            pass
    if s.get("success_rate") is not None:
        try:
            sr = float(s.get("success_rate"))
            if np.isfinite(sr):
                rows.append((f"Success rate {sr:.0f}%", 17, False, MUTED))
        except Exception:
            pass
    quality = result.get("quality") or {}
    if not isinstance(quality, dict):
        quality = {}
    issues = quality.get("issues") or []
    issue_texts = [str(i) for i in issues if i not in (None, "")][:4]
    if issue_texts:
        rows.append((f"Quality: {', '.join(issue_texts)}", 16, False, MUTED))
    failures_list = result.get("failures") or []
    if failures_list:
        dense_card = img.height < 260 or img.width < 220
        limit = 1 if dense_card else 2
        msgs = []
        for f in failures_list[:limit]:
            if isinstance(f, dict) and f.get("message"):
                code = f.get("code")
                msg = str(f.get("message"))
                text_msg = f"{code}: {msg}" if code not in (None, "") else msg
                if dense_card and len(text_msg) > 90:
                    text_msg = text_msg[:87].rstrip() + "..."
                msgs.append(text_msg)
        if msgs:
            rows.append((f"Details: {'; '.join(msgs)}", 14 if dense_card else 15, False, MUTED))
    metrics = []
    for m in (result.get("session_metrics") or []):
        if not isinstance(m, dict):
            continue
        if m.get("kind") in ("metric", "matchup"):
            metrics.append(m)
    metrics = metrics[:5]
    for m in metrics:
        unit = m.get("unit")
        try:
            val = float(m.get("value"))
            if not np.isfinite(val):
                continue
            best = ""
            if m.get("best") is not None:
                try:
                    b = float(m.get("best"))
                    if np.isfinite(b):
                        best = f"   best {_fmt(b, unit)}"
                except Exception:
                    best = ""
            label = m.get("label") or m.get("key") or "Metric"
            rows.append(
                (f"-  {label}: {_fmt(val, unit)}{best}", 18, False, (225, 225, 230))
            )
        except Exception:
            continue
    if s.get("focus_areas"):
        rows.append(("Focus", 19, True, (255, 205, 60)))
        focus = s.get("focus_areas") or []
        rows += [(f"-  {f}", 17, False, (225, 225, 230)) for f in focus[:3] if f is not None]
    rows.append((f"CoachXYZ  |  {pack.label} pack v{pack.version}", 15, False, MUTED))
    for i, (text, size, bold, color) in enumerate(rows):
        if y > bottom:
            break
        size_px = int(size * k)
        y = _draw_wrapped(d, text, x, y, size_px, bold, color, max_w, bottom=bottom, last=i == len(rows) - 1)
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


def _reason_card(frame: np.ndarray, result: dict, pack: Pack, k: float, reason: str) -> np.ndarray:
    s = result.get("summary", {})
    img = Image.fromarray(frame[:, :, ::-1]).convert("RGB")
    img = Image.blend(img, Image.new("RGB", img.size, (10, 12, 18)), 0.9)
    d = ImageDraw.Draw(img)
    x = int(img.width * 0.06) if img.width < 260 else int(img.width * 0.08)
    y = int(img.height * 0.08) if img.height < 260 else int(img.height * 0.14)
    max_w = float(max(24, img.width - x - x))
    bottom = img.height - max(10, int(img.height * 0.06)) if img.height < 260 else img.height - int(img.height * 0.08)
    # Prioritize honesty notes, failure reasons and confidence labels before metadata.
    rows = [
        ("Session summary", 38, True, (255, 255, 255)),
        (f"{s.get('events', 0)} moments", 24, False, (255, 205, 60)),
        (reason, 20, False, (255, 255, 255)),
    ]
    conf = s.get("confidence")
    conf_kind = s.get("confidence_kind")
    if conf is not None:
        try:
            conf_f = float(conf)
            if np.isfinite(conf_f):
                label = "Confidence"
                if conf_kind == "event":
                    label = "Event confidence"
                elif conf_kind == "tracking":
                    label = "Tracking confidence"
                elif conf_kind == "pose":
                    label = "Pose confidence"
                rows.append((f"{label} {conf_f:.0%}", 16, False, MUTED))
        except Exception:
            pass
    issues = (result.get("quality") or {}).get("issues") or []
    issue_texts = [str(i) for i in issues if i not in (None, "")][:4]
    if issue_texts:
        rows.append((f"Quality: {', '.join(issue_texts)}", 16, False, MUTED))
    failures_list = result.get("failures") or []
    if failures_list:
        dense_card = img.height < 260 or img.width < 220
        limit = 1 if dense_card else 3
        msgs = []
        for f in failures_list[:limit]:
            if not isinstance(f, dict):
                continue
            msg = f.get("message")
            code = f.get("code")
            if msg in (None, ""):
                continue
            text_msg = f"{code}: {msg}" if code not in (None, "") else str(msg)
            if dense_card and len(text_msg) > 90:
                text_msg = text_msg[:87].rstrip() + "..."
            msgs.append(text_msg)
        if msgs:
            rows.append((f"Details: {'; '.join(msgs)}", 14 if dense_card else 15, False, MUTED))
    rows.append((f"CoachXYZ  |  {pack.label} pack v{pack.version}", 15, False, MUTED))
    for i, (text, size, bold, color) in enumerate(rows):
        if y > bottom:
            break
        size_px = int(size * k)
        y = _draw_wrapped(d, text, x, y, size_px, bold, color, max_w, bottom=bottom, last=i == len(rows) - 1)
    return np.asarray(img)[:, :, ::-1].copy()


def render_empty(
    src: str,
    result: dict,
    pack: Pack,
    out: str,
    media: Media,
    *,
    reason: str = "No confirmed actions were detected in this clip.",
) -> list[str]:
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ok, first = cap.read()
    cap.release()
    if not ok:
        first = np.zeros((720, 1280, 3), np.uint8)
    h, w = first.shape[:2]
    scale = min(1.0, 1080 / h)
    size = (int(w * scale) // 2 * 2, int(h * scale) // 2 * 2)
    if scale < 1:
        first = cv2.resize(first, size, interpolation=cv2.INTER_AREA)
    k = size[1] / 720
    card = _reason_card(first, result, pack, k, reason)
    with FFmpegWriter(out, size[0], size[1], fps, audio_from=src) as writer:
        for _ in range(max(1, int(fps * 3.0))):
            writer.write(card)
    return []


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
    banner_max_h = max(int(90 * k), size[1] - int(120 * k))
    sprites = {
        e["id"]: _banner(e, banner_w, k, max_h=banner_max_h) for e in events
    }
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
                sprite = sprites[e["id"]]
                top_y = int(80 * k)
                bottom_y = size[1] - sprite[0].shape[0] - int(26 * k)
                _blit(frame, sprite, int(24 * k), max(top_y, bottom_y))
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
