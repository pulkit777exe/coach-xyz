"""
utils.py — Shared helper functions for the sports analyzer.
"""

import cv2


def parse_timestamp(timestamp: str) -> float:
    """Convert a timestamp string like '0:07.5' or '1:23.4' to seconds."""
    minutes, seconds = timestamp.split(':')
    return float(minutes) * 60 + float(seconds)


def timestamp_to_frame(timestamp: str, fps: int) -> int:
    """Convert a timestamp string to a frame number."""
    return int(parse_timestamp(timestamp) * fps)


def wrap_text(text: str, font, scale: float, thickness: int, max_width: int) -> list[str]:
    """
    Word-wrap `text` so each line fits within `max_width` pixels.
    Returns a list of line strings.
    """
    words = text.split()
    lines = []
    current_line = []

    for word in words:
        test_line = ' '.join(current_line + [word])
        (w, _), _ = cv2.getTextSize(test_line, font, scale, thickness)
        if w <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]

    if current_line:
        lines.append(' '.join(current_line))

    return lines


def get_video_props(cap) -> dict:
    """Return a dict of common VideoCapture properties."""
    return {
        'fps':    int(cap.get(cv2.CAP_PROP_FPS)),
        'width':  int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        'frames': int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    }