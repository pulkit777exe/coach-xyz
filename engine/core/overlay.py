"""
overlay.py — Drawing functions for the sports analyzer video overlay.

All draw_* functions mutate the frame in-place (no copies).
Coordinates are in pixels; colours are BGR tuples.

Font sizes and geometry are derived from the frame width so overlays are
proportional at any resolution (960p, 1080p, 4K, etc.).
"""

import cv2
import numpy as np
from core.utils import wrap_text


# ═══════════════════════════════════════════════════════════════════════════════
# 0. Resolution-aware scaling helper
# ═══════════════════════════════════════════════════════════════════════════════

_BASE_WIDTH = 1920.0   # the width all the "design" sizes were originally tuned for

def _s(frame_width: int, value: float) -> float:
    """Return *value* scaled proportionally to *frame_width*."""
    return value * (frame_width / _BASE_WIDTH)

def _si(frame_width: int, value: float) -> int:
    """Integer version of _s()."""
    return max(1, int(round(_s(frame_width, value))))


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Color animation (white → pulse → white)
# ═══════════════════════════════════════════════════════════════════════════════

def get_animation_color(
    elapsed: float,
    duration: float,
    is_positive: bool,
    positive_color: tuple,
    negative_color: tuple,
) -> tuple:
    """
    Pulse from white → sport colour → white over *duration* seconds.
    Returns a BGR tuple.
    """
    WHITE = (255, 255, 255)
    if elapsed >= duration:
        return WHITE

    target   = positive_color if is_positive else negative_color
    progress = elapsed / duration

    if progress < 0.5:
        t = progress * 2                                       # 0 → 1
        return tuple(int(WHITE[i] + t * (target[i] - WHITE[i])) for i in range(3))
    else:
        t = (progress - 0.5) * 2                               # 0 → 1
        return tuple(int(target[i] + t * (WHITE[i] - target[i])) for i in range(3))


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Player label (arrow + name above head)
# ═══════════════════════════════════════════════════════════════════════════════

def draw_player_label(frame, head_xy: tuple, player_name: str, primary_color: tuple):
    """Draw a coloured arrow and name tag above the detected head position."""
    if head_xy is None:
        return

    h, w = frame.shape[:2]
    head_x, head_y = head_xy
    ARROW_H = _si(w, 18)
    ARROW_W = _si(w, 28)
    tip_y   = max(0, head_y - _si(w, 70))

    pts = np.array([
        [head_x,              tip_y + ARROW_H],
        [head_x - ARROW_W//2, tip_y          ],
        [head_x + ARROW_W//2, tip_y          ],
    ], np.int32).reshape((-1, 1, 2))
    cv2.fillPoly(frame, [pts], primary_color)

    font       = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = _s(w, 1.1)
    thickness  = _si(w, 3)
    (tw, th), _ = cv2.getTextSize(player_name, font, font_scale, thickness)
    tx = head_x - tw // 2
    ty = tip_y - _si(w, 8)

    cv2.putText(frame, player_name, (tx, ty), font, font_scale,
                (0, 0, 0), thickness * 2 + 1, cv2.LINE_AA)
    cv2.putText(frame, player_name, (tx, ty), font, font_scale,
                (255, 255, 255), thickness, cv2.LINE_AA)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Stats overlay (top-left)
# ═══════════════════════════════════════════════════════════════════════════════

def draw_stats(
    frame,
    stats_to_draw: list,        # [{'label': str, 'value': int, 'highlight': bool}]
    anim_color: tuple,
    last_result_is_positive: bool,
):
    """Render each stat line in the top-left corner."""
    h, w   = frame.shape[:2]
    font      = cv2.FONT_HERSHEY_SIMPLEX
    scale     = _s(w, 0.85)
    thickness = _si(w, 2)
    border_t  = _si(w, 5)
    spacing   = _si(w, 36)
    x         = _si(w, 14)
    y         = _si(w, 60)
    WHITE     = (255, 255, 255)

    for stat in stats_to_draw:
        text  = f"{stat['label']}: {stat['value']}"
        color = anim_color if stat['highlight'] else WHITE

        cv2.putText(frame, text, (x, y), font, scale,
                    (0, 0, 0), border_t, cv2.LINE_AA)
        cv2.putText(frame, text, (x, y), font, scale,
                    color, thickness, cv2.LINE_AA)
        y += spacing


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Feedback caption (bottom-centre)
# ═══════════════════════════════════════════════════════════════════════════════

def draw_feedback(frame, feedback_text: str, frame_width: int, frame_height: int):
    """Render word-wrapped feedback text centred at the bottom of the frame."""
    if not feedback_text:
        return

    font      = cv2.FONT_HERSHEY_SIMPLEX
    scale     = _s(frame_width, 0.72)
    thickness = _si(frame_width, 2)
    border_t  = _si(frame_width, 4)
    spacing   = _si(frame_width, 26)
    WHITE     = (255, 255, 255)
    BLACK     = (0, 0, 0)

    max_w = int(frame_width * 0.80)
    lines = wrap_text(feedback_text, font, scale, thickness, max_w)

    total_h = len(lines) * spacing
    start_y = frame_height - _si(frame_width, 40) - total_h

    # Semi-transparent backing strip so text is always readable
    if lines:
        strip_pad = _si(frame_width, 8)
        strip_top = start_y - spacing - strip_pad
        strip_bot = start_y + total_h + strip_pad
        backing = frame.copy()
        cv2.rectangle(backing, (0, strip_top), (frame_width, strip_bot), (0, 0, 0), -1)
        cv2.addWeighted(backing, 0.45, frame, 0.55, 0, frame)

    for i, line in enumerate(lines):
        (tw, _), _ = cv2.getTextSize(line, font, scale, thickness)
        tx = (frame_width - tw) // 2
        ty = start_y + i * spacing

        cv2.putText(frame, line, (tx, ty), font, scale,
                    BLACK, border_t, cv2.LINE_AA)
        cv2.putText(frame, line, (tx, ty), font, scale,
                    WHITE, thickness, cv2.LINE_AA)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Form score badge (top-right circle)
# ═══════════════════════════════════════════════════════════════════════════════

def _score_color(score: int) -> tuple:
    """Return a BGR colour for the given form score (1–10)."""
    if score >= 8:
        return (0, 200, 0)      # green
    elif score >= 5:
        return (0, 180, 255)    # orange
    else:
        return (0, 60, 255)     # red


def draw_form_score(frame, score: int, frame_width: int):
    """
    Draw a circular form-score badge in the top-right corner.

    The circle is filled with a colour that reflects how good
    the score is (green / orange / red).
    """
    if score is None:
        return

    radius   = _si(frame_width, 28)
    margin   = _si(frame_width, 18)
    center_x = frame_width - radius - margin
    center_y = radius + margin
    color    = _score_color(score)

    # Filled circle + white ring
    cv2.circle(frame, (center_x, center_y), radius, color, -1, cv2.LINE_AA)
    cv2.circle(frame, (center_x, center_y), radius, (255, 255, 255), 2, cv2.LINE_AA)

    # Score number
    font   = cv2.FONT_HERSHEY_SIMPLEX
    text   = str(score)
    fscale = _s(frame_width, 1.1) if score < 10 else _s(frame_width, 0.9)
    thick  = _si(frame_width, 3)
    (tw, th), _ = cv2.getTextSize(text, font, fscale, thick)
    tx = center_x - tw // 2
    ty = center_y + th // 2

    cv2.putText(frame, text, (tx, ty), font, fscale,
                (0, 0, 0), thick + 2, cv2.LINE_AA)
    cv2.putText(frame, text, (tx, ty), font, fscale,
                (255, 255, 255), thick, cv2.LINE_AA)

    # "FORM" label beneath the circle
    label    = 'FORM'
    lscale   = _s(frame_width, 0.42)
    (lw, _), _ = cv2.getTextSize(label, font, lscale, 1)
    lx = center_x - lw // 2
    ly = center_y + radius + _si(frame_width, 14)

    cv2.putText(frame, label, (lx, ly), font, lscale,
                (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(frame, label, (lx, ly), font, lscale,
                (255, 255, 255), 1, cv2.LINE_AA)


_RATING_COLORS = {
    'good':       (0, 200, 0),
    'needs_work': (0, 180, 255),
    'poor':       (0, 60, 255),
}

_RATING_LABELS = {
    'good':       'Good',
    'needs_work': 'Fix',
    'poor':       'Poor',
}

_SKIP_RATINGS = {'N/A', 'n/a', 'na', 'NA', ''}


def draw_form_breakdown(
    frame,
    breakdown: dict,
    frame_width: int,
    frame_height: int,
):
    """
    Draw a semi-transparent panel on the right side listing each
    form criterion with a coloured indicator (good / needs_work / poor).

    Handles both underscore_style and "Display Style" criterion names.
    Entries with N/A ratings are skipped so the panel stays compact.
    """
    if not breakdown:
        return

    visible = [
        (k, v) for k, v in breakdown.items()
        if v not in _SKIP_RATINGS
    ]
    if not visible:
        return

    font         = cv2.FONT_HERSHEY_SIMPLEX
    label_scale  = _s(frame_width, 0.42)
    badge_scale  = _s(frame_width, 0.35)
    thickness    = 1
    line_height  = _si(frame_width, 22)
    dot_radius   = _si(frame_width, 5)
    h_pad        = _si(frame_width, 10)
    title_scale  = _s(frame_width, 0.38)

    panel_width  = _si(frame_width, 200)
    panel_height = len(visible) * line_height + _si(frame_width, 30)
    panel_x      = frame_width - panel_width - _si(frame_width, 10)

    # Place panel below the form-score badge
    badge_bottom = _si(frame_width, 28) * 2 + _si(frame_width, 28) + _si(frame_width, 18) + _si(frame_width, 14) + 10
    panel_y      = badge_bottom + _si(frame_width, 8)

    # Clamp panel to frame
    panel_y = min(panel_y, frame_height - panel_height - 10)

    # Semi-transparent dark background
    overlay = frame.copy()
    cv2.rectangle(
        overlay,
        (panel_x, panel_y),
        (panel_x + panel_width, panel_y + panel_height),
        (25, 25, 25),
        -1,
    )
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    # Panel border
    cv2.rectangle(
        frame,
        (panel_x, panel_y),
        (panel_x + panel_width, panel_y + panel_height),
        (80, 80, 80),
        1,
        cv2.LINE_AA,
    )

    # Title line
    cv2.putText(
        frame, 'FORM',
        (panel_x + h_pad, panel_y + _si(frame_width, 16)),
        font, title_scale, (180, 180, 180), 1, cv2.LINE_AA,
    )

    y = panel_y + _si(frame_width, 26)
    for criterion, rating in visible:
        color = _RATING_COLORS.get(rating, (180, 180, 180))
        badge = _RATING_LABELS.get(rating, str(rating))

        # Coloured dot
        cv2.circle(frame, (panel_x + h_pad + dot_radius, y - _si(frame_width, 3)),
                   dot_radius, color, -1, cv2.LINE_AA)

        # Criterion label — handle both underscore_style and Display Style
        label = criterion.replace('_', ' ').title()
        # Truncate long labels so they fit the panel
        max_label_w = panel_width - h_pad * 3 - dot_radius * 2 - _si(frame_width, 38)
        while True:
            (lw, _), _ = cv2.getTextSize(label, font, label_scale, thickness)
            if lw <= max_label_w or len(label) <= 4:
                break
            label = label[:-4] + '..'

        cv2.putText(
            frame, label,
            (panel_x + h_pad + dot_radius * 2 + _si(frame_width, 6), y),
            font, label_scale, (230, 230, 230), thickness, cv2.LINE_AA,
        )

        # Rating badge (right-aligned)
        (bw, _), _ = cv2.getTextSize(badge, font, badge_scale, 1)
        bx = panel_x + panel_width - h_pad - bw
        cv2.putText(
            frame, badge,
            (bx, y),
            font, badge_scale, color, 1, cv2.LINE_AA,
        )

        y += line_height


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Session summary (full-screen overlay for end of video)
# ═══════════════════════════════════════════════════════════════════════════════

def draw_session_summary(frame, summary: dict, frame_width: int, frame_height: int):
    """
    Render a full-screen session summary overlay.

    Includes: overall rating badge, key stats, top issues, strengths,
    and the priority drill for the next session.
    """
    if not summary:
        return

    # ── Dark overlay background ───────────────────────────────────────────
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (frame_width, frame_height), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.88, frame, 0.12, 0, frame)

    font  = cv2.FONT_HERSHEY_SIMPLEX
    WHITE = (255, 255, 255)
    GREY  = (160, 160, 160)
    cx    = frame_width // 2

    # ── Title ─────────────────────────────────────────────────────────────
    title_scale = _s(frame_width, 1.1)
    title       = 'SESSION SUMMARY'
    title_y     = _si(frame_width, 52)
    (tw, th), _ = cv2.getTextSize(title, font, title_scale, _si(frame_width, 3))
    tx = cx - tw // 2
    cv2.putText(frame, title, (tx, title_y), font, title_scale,
                (0, 0, 0), _si(frame_width, 5), cv2.LINE_AA)
    cv2.putText(frame, title, (tx, title_y), font, title_scale,
                WHITE, _si(frame_width, 2), cv2.LINE_AA)

    # Decorative line under title
    line_y = title_y + _si(frame_width, 10)
    cv2.line(frame, (cx - _si(frame_width, 130), line_y),
             (cx + _si(frame_width, 130), line_y), GREY, 1, cv2.LINE_AA)

    # ── Overall rating badge ──────────────────────────────────────────────
    rating = summary.get('overall_rating', 'N/A')
    rating_colors = {
        'Elite':        (0, 220, 255),
        'Advanced':     (0, 200, 0),
        'Intermediate': (0, 180, 255),
        'Developing':   (0, 130, 255),
        'Beginner':     (0, 60, 255),
    }
    r_color    = rating_colors.get(rating, GREY)
    r_scale    = _s(frame_width, 0.8)
    r_thick    = _si(frame_width, 2)
    (rw, rh), _ = cv2.getTextSize(rating.upper(), font, r_scale, r_thick)
    rx = cx - rw // 2
    ry = line_y + _si(frame_width, 42)

    # Badge background
    badge_pad     = _si(frame_width, 10)
    badge_overlay = frame.copy()
    cv2.rectangle(
        badge_overlay,
        (rx - badge_pad, ry - rh - badge_pad),
        (rx + rw + badge_pad, ry + badge_pad),
        r_color, -1,
    )
    cv2.addWeighted(badge_overlay, 0.3, frame, 0.7, 0, frame)
    cv2.rectangle(
        frame,
        (rx - badge_pad, ry - rh - badge_pad),
        (rx + rw + badge_pad, ry + badge_pad),
        r_color, 1, cv2.LINE_AA,
    )
    cv2.putText(frame, rating.upper(), (rx, ry), font, r_scale, r_color, r_thick, cv2.LINE_AA)

    # ── Key stats row ─────────────────────────────────────────────────────
    stats_y    = ry + _si(frame_width, 50)
    val_scale  = _s(frame_width, 0.9)
    lbl_scale  = _s(frame_width, 0.42)
    stat_items = [
        ('Events',   str(summary.get('total_events', 0))),
        ('Success',  f"{summary.get('success_rate_percent', 0):.0f}%"),
        ('Avg Form', f"{summary.get('average_form_score', 0):.1f}/10"),
    ]

    col_width = frame_width // (len(stat_items) + 1)
    for i, (label, value) in enumerate(stat_items):
        sx = col_width * (i + 1)

        # Value (medium)
        (vw, _), _ = cv2.getTextSize(value, font, val_scale, _si(frame_width, 3))
        cv2.putText(frame, value, (sx - vw // 2, stats_y), font, val_scale,
                    (0, 0, 0), _si(frame_width, 4), cv2.LINE_AA)
        cv2.putText(frame, value, (sx - vw // 2, stats_y), font, val_scale,
                    WHITE, _si(frame_width, 2), cv2.LINE_AA)

        # Label (small, beneath)
        (lw, _), _ = cv2.getTextSize(label, font, lbl_scale, 1)
        cv2.putText(frame, label, (sx - lw // 2, stats_y + _si(frame_width, 20)),
                    font, lbl_scale, GREY, 1, cv2.LINE_AA)

    # ── Sections: issues, strengths, drill ────────────────────────────────
    section_x  = _si(frame_width, 40)
    y_cursor   = stats_y + _si(frame_width, 56)
    head_scale = _s(frame_width, 0.55)
    body_scale = _s(frame_width, 0.44)
    line_gap   = _si(frame_width, 22)
    section_gap = _si(frame_width, 10)

    def _draw_section(heading, items, color, is_list=True):
        nonlocal y_cursor
        cv2.putText(frame, heading, (section_x, y_cursor), font, head_scale,
                    color, _si(frame_width, 2), cv2.LINE_AA)
        y_cursor += _si(frame_width, 26)

        if is_list and isinstance(items, list):
            for item in items:
                bullet = f'\u25b8  {item}'
                lines = wrap_text(bullet, font, body_scale, 1,
                                  frame_width - section_x * 2)
                for line in lines:
                    cv2.putText(frame, line, (section_x + _si(frame_width, 10), y_cursor),
                                font, body_scale, WHITE, 1, cv2.LINE_AA)
                    y_cursor += line_gap
        elif isinstance(items, str):
            lines = wrap_text(items, font, body_scale, 1,
                              frame_width - section_x * 2)
            for line in lines:
                cv2.putText(frame, line, (section_x + _si(frame_width, 10), y_cursor),
                            font, body_scale, WHITE, 1, cv2.LINE_AA)
                y_cursor += line_gap

        y_cursor += section_gap

    _draw_section(
        'TOP ISSUES',
        summary.get('top_issues', []),
        (0, 100, 255),
    )
    _draw_section(
        'STRENGTHS',
        summary.get('strengths', []),
        (0, 200, 0),
    )
    _draw_section(
        'NEXT SESSION FOCUS',
        summary.get('priority_drill', ''),
        (0, 180, 255),
        is_list=False,
    )