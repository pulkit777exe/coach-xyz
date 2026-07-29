"""
analyze_session.py — Engine-side JSON analysis bridge for server jobs.

Runs core.analyzer.analyze() and prints ONLY JSON on stdout.
Verbose engine logs are redirected to stderr.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import pathlib
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

from core.gemini import analyze_video
from core.chunker import analyze_long_video, needs_chunking

SUPPORTED_SPORTS = {"basketball", "football", "cricket"}


def _load_sport_config(sport: str) -> dict:
    config_path = ROOT.parent / "sports" / f"{sport}.json"
    with open(config_path, "r") as f:
        return json.load(f)


def _pick_render_source(
    analysis_result: Any,
    players: list[dict] | None,
) -> tuple[dict | None, str | None]:
    if isinstance(analysis_result, dict) and "shots" in analysis_result:
        return analysis_result, None

    if not isinstance(analysis_result, dict) or not players:
        return None, None

    for player in players:
        label = str(player.get("label") or f"Player {player.get('player_index', '?')}")
        value = analysis_result.get(label)
        if isinstance(value, dict) and "shots" in value:
            if not value.get("player_name"):
                value["player_name"] = label
            return value, label

    return None, None


def _render_video(video_path: str, analysis_result: dict, output_path: str) -> None:
    sport = str(analysis_result.get("sport", "")).lower()
    if sport not in SUPPORTED_SPORTS:
        return

    # NOTE: Legacy render path — new pipeline uses core.renderer.render_video()
    # This stub is kept for CLI backward compat. The analysis_result structure
    # differs from what render_video expects (needs active_player_landmarks_per_frame).
    print(f"[CLI] Rendering not available for sport '{sport}' — skipping.", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CoachAI analysis and emit JSON.")
    parser.add_argument("--video", required=True, help="Path to source video")
    parser.add_argument("--model", default="gemini-2.5-flash", help="Gemini model")
    parser.add_argument("--players-json", default="", help="JSON array of selected players")
    parser.add_argument("--players-file", default="", help="Path to JSON file with selected players")
    parser.add_argument("--output", default="", help="Rendered output video path")
    parser.add_argument("--events-only", action="store_true", help="Skip rendering")
    parser.add_argument("--strict", action="store_true", help="Strict validation")
    args = parser.parse_args()

    # Match CLI behavior: load engine/.env for GEMINI_API_KEY and related vars.
    load_dotenv(ROOT / ".env")

    players = None
    players_source = args.players_json
    if args.players_file:
        players_source = pathlib.Path(args.players_file).read_text()

    if players_source:
        try:
            parsed = json.loads(players_source)
            players = parsed if isinstance(parsed, list) else None
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid players payload: {exc}") from exc

    with contextlib.redirect_stdout(sys.stderr):
        # Keep multi-player path in core.gemini.analyze_video().
        # For single-player / no players, reuse chunking behavior from CLI.
        if players:
            result = analyze_video(
                video_path=args.video,
                model_name=args.model,
                strict=args.strict,
                player_focus=players[0] if len(players) == 1 else None,
            )
        else:
            should_chunk, _ = needs_chunking(args.video)
            if should_chunk:
                result = analyze_long_video(
                    video_path=args.video,
                    model_name=args.model,
                    strict=args.strict,
                    player_focus=None,
                )
            else:
                result = analyze_video(
                    video_path=args.video,
                    model_name=args.model,
                    strict=args.strict,
                )

        render_source, rendered_player_label = _pick_render_source(result, players)
        rendered_video_path = None

        if not args.events_only and render_source is not None:
            if args.output:
                output_path = pathlib.Path(args.output)
            else:
                output_path = pathlib.Path(args.video).with_name(
                    f"{pathlib.Path(args.video).stem}_analyzed.mp4"
                )
            output_path.parent.mkdir(parents=True, exist_ok=True)

            _render_video(args.video, render_source, str(output_path))
            if output_path.exists():
                rendered_video_path = str(output_path.resolve())

    payload = {
        "analysis": result,
        "rendered_video_path": rendered_video_path,
        "rendered_player_label": rendered_player_label,
    }
    print(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
