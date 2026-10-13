"""
frame_selector.py — Engine-side candidate frame selector for player selection.

Outputs JSON only:
{
  "frames": [
    {
      "frame_index": int,
      "timestamp_s": float,
      "score": float,
      "frame_base64": str,
      "players": [
        {
          "player_index": int,
          "bbox": {"x_min": int, "y_min": int, "x_max": int, "y_max": int},
          "head_y": int
        }
      ]
    }
  ]
}
"""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import sys

import cv2

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "cli" / "_legacy"))

from player_tracker import score_frames


def _frame_to_base64(video_path: str, frame_index: int) -> str:
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_index))
    ok, frame = cap.read()
    cap.release()

    if not ok or frame is None:
        return ""

    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        return ""

    return base64.b64encode(encoded.tobytes()).decode("utf-8")


def _fallback_frames(video_path: str) -> list[dict]:
    from core.player_detector import detect_players

    result = detect_players(video_path)
    frame_index = int(result.get("frame_index", 0))
    timestamp_s = float(result.get("frame_ts_s", 0.0))
    raw_players = result.get("players", []) or []

    players: list[dict] = []
    for p in raw_players:
        x, y, w, h = p.bbox
        players.append(
            {
                "player_index": int(p.id) - 1,
                "bbox": {
                    "x_min": int(x),
                    "y_min": int(y),
                    "x_max": int(x + w),
                    "y_max": int(y + h),
                },
                "head_y": int(y),
            }
        )

    frame_base64 = _frame_to_base64(video_path, frame_index)
    if not frame_base64 or not players:
        return []

    return [
        {
            "frame_index": frame_index,
            "timestamp_s": timestamp_s,
            "score": 0.0,
            "frame_base64": frame_base64,
            "players": players,
        }
    ]


def _players_from_skeletons(skeletons: list[dict]) -> list[dict]:
    ordered = sorted(
        skeletons,
        key=lambda s: float((s.get("centroid") or (0.0, 0.0))[0]),
    )

    players: list[dict] = []
    for idx, skeleton in enumerate(ordered):
        bbox = skeleton.get("bbox") or {}
        x_min = int(float(bbox.get("x_min", 0)))
        y_min = int(float(bbox.get("y_min", 0)))
        x_max = int(float(bbox.get("x_max", 0)))
        y_max = int(float(bbox.get("y_max", 0)))

        if x_max <= x_min or y_max <= y_min:
            continue

        players.append(
            {
                "player_index": idx,
                "bbox": {
                    "x_min": x_min,
                    "y_min": y_min,
                    "x_max": x_max,
                    "y_max": y_max,
                },
                "head_y": y_min,
            }
        )

    return players


def main() -> None:
    parser = argparse.ArgumentParser(description="Select best player frames from video.")
    parser.add_argument("--video", required=True, help="Path to source video")
    parser.add_argument("--top-k", type=int, default=5, help="Max frames to return")
    args = parser.parse_args()

    frames_out: list[dict] = []

    try:
        scored = score_frames(args.video)
        for scored_frame in scored[: max(1, args.top_k)]:
            frame_base64 = _frame_to_base64(args.video, int(scored_frame.frame_index))
            if not frame_base64:
                continue

            players = _players_from_skeletons(scored_frame.detected_skeletons)
            if not players:
                continue

            frames_out.append(
                {
                    "frame_index": int(scored_frame.frame_index),
                    "timestamp_s": float(scored_frame.timestamp_s),
                    "score": float(scored_frame.total_score),
                    "frame_base64": frame_base64,
                    "players": players,
                }
            )
    except Exception as exc:
        print(
            f"[frame_selector] score_frames failed ({exc}); falling back to detect_players.",
            file=sys.stderr,
        )
        frames_out = _fallback_frames(args.video)

    print(json.dumps({"frames": frames_out}, separators=(",", ":")))


if __name__ == "__main__":
    main()
