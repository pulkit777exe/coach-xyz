"""
main.py — CLI entry point for the multi-sport AI video analyzer.

Usage
-----
    python main.py analyze <path_to_video>

That single command will:
  1. Upload the video to Gemini and get structured event JSON.
  2. Render the AI-generated overlay back onto the original video.
  3. Save the final video to the OS Downloads folder.

Optional flags for analyze
--------------------------
  -o / --output     Override the output .mp4 path (default: ~/Downloads/<name>_analyzed.mp4)
  -m / --model      Gemini model (default: gemini-2.5-flash)
  --strict          Exit with error on validation warnings
  --preview         Show a live OpenCV preview window while rendering
  --events-only     Only run the Gemini analysis; skip the render step
"""

import argparse
import json
import os
import sys
import pathlib

from dotenv import load_dotenv

# Load .env from project root before any other imports that need env vars
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# Ensure the project root is importable
sys.path.insert(0, os.path.dirname(__file__))

from core.analyzer import SportsAnalyzer

SUPPORTED_SPORTS = ['basketball', 'football', 'cricket']
PROJECT_ROOT     = os.path.dirname(os.path.abspath(__file__))


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_downloads_dir() -> str:
    """Return the OS Downloads directory (works on Linux, macOS, Windows)."""
    # XDG_DOWNLOAD_DIR is the standard on Linux desktop environments
    xdg = os.environ.get('XDG_DOWNLOAD_DIR')
    if xdg and os.path.isdir(xdg):
        return xdg
    default = os.path.join(pathlib.Path.home(), 'Downloads')
    os.makedirs(default, exist_ok=True)
    return default


def load_json(path: str) -> dict:
    with open(path, 'r') as f:
        return json.load(f)


def save_json(path: str, data: dict):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'Saved JSON → {path}')


def resolve_sport_config(sport: str) -> dict:
    """Load the sport config from sports/<sport>.json."""
    config_path = os.path.join(PROJECT_ROOT, 'sports', f'{sport}.json')
    if not os.path.exists(config_path):
        print(f'ERROR: Sport config not found at {config_path}')
        sys.exit(1)
    return load_json(config_path)


# ── Subcommand: analyze (+ auto-render) ──────────────────────────────────────

def cmd_analyze(args):
    """
    Full pipeline:
      1. Upload video to Gemini → JSON analysis.
      2. Render overlay onto the original video.
      3. Save final .mp4 to Downloads (or --output path).
    """
    from core.gemini import analyze_video

    video_path = os.path.abspath(args.video)
    if not os.path.isfile(video_path):
        print(f'ERROR: Video file not found: {video_path}')
        sys.exit(1)

    base_name = os.path.splitext(os.path.basename(video_path))[0]

    # ── Step 1: Gemini analysis ───────────────────────────────────────────
    print(f'\n── Step 1 / 2  Gemini Analysis ────────────────────────────────')
    print(f'Analyzing video: {video_path}')
    result = analyze_video(
        video_path=video_path,
        model_name=args.model,
        strict=args.strict,
    )

    # Save the event JSON alongside the project events/ folder
    events_dir  = os.path.join(PROJECT_ROOT, 'events')
    events_path = os.path.join(events_dir, f'{base_name}.json')
    save_json(events_path, result)

    detected_sport = result.get('sport', 'unknown')
    n_events       = len(result.get('shots', []))
    print(f'\nSport detected : {detected_sport}')
    print(f'Events found   : {n_events}')

    summary = result.get('session_summary')
    if summary:
        print(f'Overall rating : {summary.get("overall_rating", "N/A")}')
        print(f'Success rate   : {summary.get("success_rate_percent", 0):.1f}%')
        print(f'Avg form score : {summary.get("average_form_score", 0):.1f}/10')

    if args.events_only:
        print('\n--events-only flag set — skipping render.')
        return

    # ── Step 2: Overlay render ────────────────────────────────────────────
    print(f'\n── Step 2 / 2  Overlay Render ─────────────────────────────────')

    if detected_sport not in SUPPORTED_SPORTS:
        print(f'WARNING: Sport "{detected_sport}" is not in the supported render list {SUPPORTED_SPORTS}.')
        print('Skipping render step. Use --events-only to suppress this warning.')
        return

    sport_config = resolve_sport_config(detected_sport)

    # Determine output path
    if args.output:
        output_path = os.path.abspath(args.output)
    else:
        downloads   = get_downloads_dir()
        output_path = os.path.join(downloads, f'{base_name}_analyzed.mp4')

    analyzer = SportsAnalyzer(
        sport_config  = sport_config,
        event_data    = result,
        process_video = video_path,   # same video for both process & display
        display_video = video_path,
        output_path   = output_path,
        preview       = args.preview,
    )
    analyzer.run()

    print(f'\n✅  All done!')
    print(f'   Event JSON  → {events_path}')
    print(f'   Final video → {output_path}')


# ── CLI definition ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Multi-sport AI video analyzer — one command does it all.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            'Example:\n'
            '  python main.py analyze video.mp4\n'
            '  python main.py analyze /path/to/session.mp4 --preview\n'
            '  python main.py analyze video.mp4 -o /tmp/out.mp4\n'
        ),
    )
    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # ── analyze ───────────────────────────────────────────────────────────
    p_analyze = subparsers.add_parser(
        'analyze',
        help='Analyze a video with Gemini AI and render the overlay — all in one step.',
    )
    p_analyze.add_argument(
        'video',
        help='Path to the video file to analyze (.mp4, .mov, etc.)',
    )
    p_analyze.add_argument(
        '-o', '--output',
        default=None,
        help='Output .mp4 path (default: ~/Downloads/<name>_analyzed.mp4)',
    )
    p_analyze.add_argument(
        '-m', '--model',
        default='gemini-2.5-flash',
        help='Gemini model to use (default: gemini-2.5-flash)',
    )
    p_analyze.add_argument(
        '--strict',
        action='store_true',
        help='Exit with error on validation warnings',
    )
    p_analyze.add_argument(
        '--preview',
        action='store_true',
        help='Show a live OpenCV preview window while rendering',
    )
    p_analyze.add_argument(
        '--events-only',
        action='store_true',
        help='Only run the Gemini analysis step; skip the overlay render',
    )
    p_analyze.set_defaults(func=cmd_analyze)

    # ── Dispatch ──────────────────────────────────────────────────────────
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    args.func(args)


if __name__ == '__main__':
    main()
