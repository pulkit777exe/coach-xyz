"""
cli/main.py — CoachAI command-line interface with Rich UI.

Features
--------
  • Player detection  — captures a richly-annotated JPEG to ~/Downloads so you
                        can see who's in the frame, including jersey colours and
                        confidence scores, then pick who to analyse.
  • Multi-player or all-player analysis.
  • Rich terminal UI  — panels, progress bars, tables, live status.
  • Auto-chunking     — videos > 4 min are split and processed via LangChain.
  • API mode          — pass --api-url to route through the FastAPI backend.

Usage examples
--------------
  python cli/main.py analyze video.mp4
  python cli/main.py analyze video.mp4 --skip-detection
  python cli/main.py analyze video.mp4 --events-only
  python cli/main.py analyze video.mp4 --api-url http://localhost:8000
"""

import json
import os
import pathlib
import subprocess
import sys
import time

# ── Path bootstrap ────────────────────────────────────────────────────────────
ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

# ── Rich imports ──────────────────────────────────────────────────────────────
from rich.align           import Align
from rich.columns         import Columns
from rich.console         import Console
from rich.markup          import escape
from rich.padding         import Padding
from rich.panel           import Panel
from rich.progress        import (BarColumn, Progress, SpinnerColumn,
                                  TaskProgressColumn, TextColumn,
                                  TimeElapsedColumn)
from rich.prompt          import Prompt
from rich.rule            import Rule
from rich.table           import Table
from rich.text            import Text
from rich.theme           import Theme

console = Console(theme=Theme({
    "accent":   "bold cyan",
    "dim":      "dim white",
    "good":     "bold green",
    "warn":     "bold yellow",
    "bad":      "bold red",
    "player1":  "bold cyan",
    "player2":  "bold blue",
    "player3":  "bold green",
    "player4":  "bold magenta",
    "player5":  "bold yellow",
}))

PLAYER_RICH_STYLES = [
    "bold cyan", "bold blue", "bold green",
    "bold magenta", "bold yellow", "bold red",
    "bold white", "bold orange3",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _downloads_dir() -> pathlib.Path:
    xdg = os.environ.get("XDG_DOWNLOAD_DIR")
    if xdg and pathlib.Path(xdg).is_dir():
        return pathlib.Path(xdg)
    d = pathlib.Path.home() / "Downloads"
    d.mkdir(exist_ok=True)
    return d


def _save_json(path: pathlib.Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def _fmt_dur(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}m {s}s"


def _fmt_dur_compact(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m}m {s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m"


def _fmt_eta_range(min_s: float, max_s: float) -> str:
    if max_s <= 0:
        return "under 10s"
    if min_s <= 10:
        return f"up to {_fmt_dur_compact(max_s)}"
    return f"{_fmt_dur_compact(min_s)} to {_fmt_dur_compact(max_s)}"


def _remaining_eta_range(start_ts: float, min_s: float, max_s: float) -> tuple[float, float]:
    elapsed = max(0.0, time.time() - start_ts)
    return max(0.0, min_s - elapsed), max(0.0, max_s - elapsed)


def _with_eta(description: str, start_ts: float, min_s: float, max_s: float) -> str:
    left_min, left_max = _remaining_eta_range(start_ts, min_s, max_s)
    return f"{description} (ETA {_fmt_eta_range(left_min, left_max)})"


def _env_truthy(name: str) -> bool:
    value = os.environ.get(name)
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _estimate_chunk_count(duration_s: float) -> int:
    from core.chunker import CHUNK_DURATION_S, CHUNK_OVERLAP_S

    step = max(1, CHUNK_DURATION_S - CHUNK_OVERLAP_S)
    effective = max(duration_s, CHUNK_OVERLAP_S + 1)
    return max(1, int((effective - CHUNK_OVERLAP_S) / step) + 1)


def _estimate_analysis_eta_range(duration_s: float, should_chunk: bool) -> tuple[float, float]:
    if should_chunk:
        from core.chunker import CHUNK_DURATION_S, CHUNK_WORKERS

        chunks = _estimate_chunk_count(duration_s)
        workers = max(1, CHUNK_WORKERS)

        per_chunk_min = max(150.0, CHUNK_DURATION_S * 2.2)
        per_chunk_max = max(300.0, CHUNK_DURATION_S * 3.8)

        min_s = (chunks * per_chunk_min) / workers
        max_s = (chunks * per_chunk_max) / max(1.0, workers * 0.75)
    else:
        min_s = max(90.0, duration_s * 1.8 + 45.0)
        max_s = max(180.0, duration_s * 3.2 + 75.0)

    if _env_truthy("COACHAI_ANALYSIS_PROXY"):
        min_s *= 0.8
        max_s *= 0.85

    return min_s, max_s


def _estimate_render_eta_range(duration_s: float) -> tuple[float, float]:
    return max(30.0, duration_s * 0.45), max(60.0, duration_s * 1.05)


def _open_image(path: pathlib.Path):
    """Try to open an image with the system viewer (best-effort)."""
    for cmd in (["xdg-open"], ["eog"], ["display"], ["feh"], ["open"]):
        try:
            subprocess.Popen(
                cmd + [str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except FileNotFoundError:
            continue


def _hex_to_rich_bg(hex_color: str) -> str:
    """
    Convert a HTML hex colour to a Rich markup string showing a coloured block.
    e.g.  "#3c78ff"  →  "[bold #3c78ff]██[/]"
    Falls back to dim white if parse fails.
    """
    try:
        h = hex_color.lstrip("#")
        if len(h) == 6:
            return f"[bold #{h}]██[/]"
    except Exception:
        pass
    return "[dim white]██[/]"


# ── Banner ────────────────────────────────────────────────────────────────────

def _banner():
    console.print()
    console.print(Align.center(
        Panel.fit(
            "[bold cyan]⚡  CoachAI[/]  [dim]·[/]  [white]Multi-Sport AI Video Analyzer[/]\n"
            "[dim]Powered by Google Gemini AI + LangChain + MediaPipe[/]",
            border_style="bright_blue",
            padding=(0, 4),
        )
    ))
    console.print()


# ── Step 0: validate video ─────────────────────────────────────────────────────

def _validate_video(video_path: pathlib.Path, events_only: bool = False):
    if not video_path.is_file():
        console.print(f"[bad]✗  Video not found:[/] {video_path}")
        sys.exit(1)

    import cv2
    cap   = cv2.VideoCapture(str(video_path))
    fps   = max(1.0, cap.get(cv2.CAP_PROP_FPS))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fw    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    dur     = total / fps
    size_mb = video_path.stat().st_size / 1024 / 1024

    info = Table.grid(padding=(0, 2))
    info.add_column(style="dim")
    info.add_column(style="white")
    info.add_row("File",        video_path.name)
    info.add_row("Size",        f"{size_mb:.1f} MB")
    info.add_row("Resolution",  f"{fw}×{fh}")
    info.add_row("Duration",    _fmt_dur(dur))
    info.add_row("FPS",         f"{fps:.1f}")

    from core.chunker import CHUNK_THRESHOLD_S
    should_chunk = dur >= CHUNK_THRESHOLD_S
    if should_chunk:
        info.add_row(
            "Mode",
            "[warn]LangChain chunking[/] (video > 4 min)",
        )
    else:
        info.add_row("Mode", "[good]Direct analysis[/]")

    analysis_min_s, analysis_max_s = _estimate_analysis_eta_range(dur, should_chunk)
    info.add_row("Est. AI time", _fmt_eta_range(analysis_min_s, analysis_max_s))

    if not events_only:
        render_min_s, render_max_s = _estimate_render_eta_range(dur)
        total_min_s = analysis_min_s + render_min_s
        total_max_s = analysis_max_s + render_max_s
        info.add_row("Est. End-to-end", _fmt_eta_range(total_min_s, total_max_s))

    console.print(Panel(info, title="[accent]📹  Video Info[/]", border_style="bright_blue"))
    console.print()
    return dur


# ── Step 1: detect players ────────────────────────────────────────────────────

def _detect_players_step(video_path: pathlib.Path) -> dict | None:
    """
    Run player detection, save the annotated image to ~/Downloads, display
    a rich selection table, and prompt the user to pick a player (or all).

    Returns
    -------
    player dict  { 'id', 'position', 'color_hex', 'jersey_hex' }
    or None      (analyse all players together)
    """
    console.print(Rule("[accent]Step 1 / 3  ·  Player Detection[/]", style="bright_blue"))
    console.print()

    from core.player_detector import detect_players, save_player_frame

    # ── Run detection with spinner ─────────────────────────────────────────
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console=console,
    ) as prog:
        task   = prog.add_task("Scanning video for players…", total=None)
        result = detect_players(str(video_path))
        prog.update(task, completed=1, total=1)

    players = result["players"]
    n       = len(players)

    # ── Save annotated frame to Downloads ─────────────────────────────────
    dl_dir   = _downloads_dir()
    img_path = save_player_frame(result["frame"], str(video_path), dl_dir)

    # ── No players found ──────────────────────────────────────────────────
    if n == 0:
        console.print(
            Panel(
                "[warn]⚠  No players could be auto-detected in this clip.[/]\n\n"
                "The full video will be analysed for all players together.\n"
                "[dim]Tip: ensure the video clearly shows the playing area.[/]",
                border_style="yellow",
                padding=(0, 2),
            )
        )
        console.print()
        return None

    # ── Player selection table ────────────────────────────────────────────
    tbl = Table(
        title=f"[bold]{n} player{'s' if n != 1 else ''} detected[/]",
        border_style="bright_blue",
        header_style="bold cyan",
        show_lines=True,
        row_styles=["", "dim"],
    )
    tbl.add_column("#",          justify="center", style="bold white", width=4)
    tbl.add_column("Position",   style="white",    width=20)
    tbl.add_column("Label\nColour", justify="center", width=10)
    tbl.add_column("Jersey\nColour", justify="center", width=10)
    tbl.add_column("Confidence", justify="right",  width=12)

    for p in players:
        style    = PLAYER_RICH_STYLES[(p.id - 1) % len(PLAYER_RICH_STYLES)]
        conf_bar = "█" * int(p.confidence * 10) + "░" * (10 - int(p.confidence * 10))
        conf_col = "good" if p.confidence >= 0.7 else ("warn" if p.confidence >= 0.4 else "bad")
        tbl.add_row(
            f"[{style}]{p.id}[/]",
            p.position,
            _hex_to_rich_bg(p.color_hex),
            _hex_to_rich_bg(p.jersey_hex),
            f"[{conf_col}]{conf_bar}[/] [{conf_col}]{p.confidence:.0%}[/]",
        )

    console.print(tbl)
    console.print()

    # ── Image saved notice ────────────────────────────────────────────────
    console.print(
        Panel(
            f"[good]📸  Player detection image saved to Downloads:[/]\n"
            f"[bold white]{img_path}[/]\n\n"
            "[dim]Open the image to see which numbered box corresponds to each "
            "player before making your selection.[/]",
            title="[accent]🖼  Annotated Screenshot[/]",
            border_style="bright_blue",
            padding=(0, 2),
        )
    )
    console.print()

    # Try to open the image viewer automatically
    console.print("[dim]Attempting to open your image viewer…[/]")
    _open_image(img_path)
    console.print()

    # ── Prompt ───────────────────────────────────────────────────────────
    choices = [str(p.id) for p in players] + ["all"]
    choice  = Prompt.ask(
        "[accent]Which player do you want to analyse?[/] "
        "[dim](enter a number or 'all')[/]",
        choices  = choices,
        default  = "all",
        console  = console,
    )
    console.print()

    if choice == "all":
        console.print("[dim]Analysing all players together.[/]\n")
        return None

    chosen = next(p for p in players if p.id == int(choice))
    style  = PLAYER_RICH_STYLES[(chosen.id - 1) % len(PLAYER_RICH_STYLES)]
    console.print(
        Panel(
            f"[good]✓[/] Focusing on [{style}]Player {chosen.id}[/] "
            f"— [white]{chosen.position}[/]  "
            f"  Label: {_hex_to_rich_bg(chosen.color_hex)}  "
            f"Jersey: {_hex_to_rich_bg(chosen.jersey_hex)}",
            border_style="green",
            padding=(0, 2),
        )
    )
    console.print()

    return {
        "id":          chosen.id,
        "position":    chosen.position,
        "color_hex":   chosen.color_hex,
        "jersey_hex":  chosen.jersey_hex,
    }


# ── Step 2: run analysis ───────────────────────────────────────────────────────

def _run_analysis(
    video_path:   pathlib.Path,
    model:        str,
    strict:       bool,
    player_focus: dict | None,
    duration_s:   float,
) -> dict:
    from core.chunker import needs_chunking

    console.print(Rule("[accent]Step 2 / 3  ·  Gemini AI Analysis[/]", style="bright_blue"))
    console.print()

    should_chunk, _ = needs_chunking(str(video_path))

    if should_chunk:
        _warn_long_video(duration_s)
        result = _run_chunked(video_path, model, strict, player_focus, duration_s)
    else:
        result = _run_direct(video_path, model, strict, player_focus, duration_s)

    return result


def _warn_long_video(duration_s: float):
    from core.chunker import CHUNK_DURATION_S, CHUNK_OVERLAP_S, CHUNK_WORKERS

    n_chunks = max(1, int((duration_s - CHUNK_OVERLAP_S) /
                           (CHUNK_DURATION_S - CHUNK_OVERLAP_S)) + 1)
    eta_min_s, eta_max_s = _estimate_analysis_eta_range(duration_s, should_chunk=True)

    info = Table.grid(padding=(0, 2))
    info.add_column(style="dim")
    info.add_column(style="white")
    info.add_row("Video length",    _fmt_dur(duration_s))
    info.add_row("Chunk size",      f"{CHUNK_DURATION_S // 60} min")
    info.add_row("Overlap",         f"{CHUNK_OVERLAP_S} s")
    info.add_row("Workers",         str(CHUNK_WORKERS))
    info.add_row("Chunks estimate", str(n_chunks))
    info.add_row("Est. AI time",    _fmt_eta_range(eta_min_s, eta_max_s))

    console.print(
        Panel(
            f"[warn]⚡ Long video detected[/] ({_fmt_dur(duration_s)})\n\n"
            "Your video will be [bold]split into overlapping analysis windows[/] and\n"
            "each window sent to Gemini separately via the\n"
            "[accent]LangChain Runnable pipeline[/].\n\n"
            "Timestamps are automatically shifted & deduplicated at chunk boundaries.",
            title="[accent]LangChain Chunking Mode[/]",
            border_style="yellow",
            padding=(0, 2),
        )
    )
    console.print(Padding(info, (0, 4)))
    console.print()


def _run_chunked(video_path, model, strict, player_focus, duration_s: float):
    from core.chunker import analyze_long_video

    messages: list[tuple[str, int]] = []
    eta_min_s, eta_max_s = _estimate_analysis_eta_range(duration_s, should_chunk=True)
    started_at = time.time()

    def _cb(msg, pct):
        messages.append((msg, pct))

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console   = console,
        transient = False,
    ) as prog:
        task = prog.add_task(
            _with_eta("LangChain pipeline initialising…", started_at, eta_min_s, eta_max_s),
            total=100,
        )

        import threading
        result_box: list = [None]
        error_box:  list = [None]

        def worker():
            try:
                result_box[0] = analyze_long_video(
                    video_path   = str(video_path),
                    model_name   = model,
                    strict       = strict,
                    player_focus = player_focus,
                    progress_cb  = _cb,
                )
            except Exception as e:
                error_box[0] = e

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        last_len = 0
        while t.is_alive() or last_len < len(messages):
            if len(messages) > last_len:
                msg, pct = messages[-1]
                prog.update(
                    task,
                    description=_with_eta(msg, started_at, eta_min_s, eta_max_s),
                    completed=pct,
                )
                last_len = len(messages)
            time.sleep(0.3)

        t.join()
        prog.update(task, completed=100, description="✅ LangChain analysis complete!")

    if error_box[0]:
        raise error_box[0]
    return result_box[0]


def _run_direct(video_path, model, strict, player_focus, duration_s: float):
    from core.gemini import analyze_video

    steps = [
        "Uploading video to Gemini…",
        "Processing video frames…",
        "Running AI analysis…",
        "Parsing AI response…",
    ]
    eta_min_s, eta_max_s = _estimate_analysis_eta_range(duration_s, should_chunk=False)
    started_at = time.time()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console   = console,
        transient = False,
    ) as prog:
        task = prog.add_task(
            _with_eta(steps[0], started_at, eta_min_s, eta_max_s),
            total=None,
        )

        result_box: list = [None]
        error_box:  list = [None]
        step_idx: list   = [0]

        def worker():
            try:
                result_box[0] = analyze_video(
                    video_path   = str(video_path),
                    model_name   = model,
                    strict       = strict,
                    player_focus = player_focus,
                )
            except Exception as e:
                error_box[0] = e

        import threading
        t = threading.Thread(target=worker, daemon=True)
        t.start()

        while t.is_alive():
            time.sleep(4)
            step_idx[0] = min(step_idx[0] + 1, len(steps) - 1)
            prog.update(
                task,
                description=_with_eta(steps[step_idx[0]], started_at, eta_min_s, eta_max_s),
            )

        t.join()

    if error_box[0]:
        console.print(f"\n[bad]✗  Analysis failed:[/] {error_box[0]}")
        raise error_box[0]

    return result_box[0]


# ── Results display ───────────────────────────────────────────────────────────

def _show_results(result: dict, events_path: pathlib.Path, video_out: pathlib.Path | None):
    summary = result.get("session_summary", {})
    shots   = result.get("shots", [])
    sport   = result.get("sport", "?")

    EMOJIS = {"basketball": "🏀", "football": "⚽", "cricket": "🏏", "tennis": "🎾", "baseball": "⚾", "hockey": "🏒"}
    emoji  = EMOJIS.get(sport, "🎯")

    console.print()
    console.print(Rule(
        f"[accent]{emoji}  {sport.capitalize()} Analysis — Results[/]",
        style="bright_blue",
    ))
    console.print()

    # ── Summary cards ─────────────────────────────────────────────────────
    RATING_STYLES = {
        "Elite":        "bold gold1",
        "Advanced":     "bold green",
        "Intermediate": "bold yellow",
        "Developing":   "bold orange3",
        "Beginner":     "bold red",
    }
    rating       = summary.get("overall_rating", "N/A")
    rating_style = RATING_STYLES.get(rating, "white")

    tbl = Table.grid(padding=(0, 3))
    tbl.add_column(justify="center")
    tbl.add_column(justify="center")
    tbl.add_column(justify="center")
    tbl.add_column(justify="center")

    tbl.add_row(
        _stat_card("⭐  Rating",   f"[{rating_style}]{rating}[/]"),
        _stat_card("🎯  Events",   str(len(shots))),
        _stat_card("✅  Success",  f"{summary.get('success_rate_percent', 0):.0f}%"),
        _stat_card("📐  Avg Form", f"{summary.get('average_form_score', 0):.1f}/10"),
    )
    console.print(Align.center(tbl))
    console.print()

    # ── Shot breakdown table ──────────────────────────────────────────────
    if shots:
        stbl = Table(
            title="Shot-by-Shot Breakdown",
            border_style="bright_blue",
            header_style="bold cyan",
            show_lines=True,
        )
        stbl.add_column("#",        justify="center", width=4)
        stbl.add_column("Time",     justify="center", width=8)
        stbl.add_column("Type",     width=18)
        stbl.add_column("Result",   width=12)
        stbl.add_column("Form",     justify="center", width=6)
        stbl.add_column("Feedback", ratio=1)

        for shot in shots[:20]:
            result_val = (shot.get("result") or "").lower()
            if result_val in ("made", "goal"):
                res_str = "[good]✅ Made[/]"
            elif result_val in ("missed",):
                res_str = "[bad]❌ Missed[/]"
            else:
                res_str = f"[warn]{result_val.capitalize()}[/]"

            form = shot.get("form_score")
            if form is not None:
                if form >= 8:
                    form_str = f"[good]{form}[/]"
                elif form >= 5:
                    form_str = f"[warn]{form}[/]"
                else:
                    form_str = f"[bad]{form}[/]"
            else:
                form_str = "[dim]—[/]"

            fb = shot.get("feedback", "")
            feedback_txt = (fb[:80] + "…") if len(fb) > 80 else fb

            stbl.add_row(
                str(shot.get("event_index", "?")),
                shot.get("timestamp_of_shot", "?"),
                shot.get("shot_type", "?").replace("_", " ").title(),
                res_str,
                form_str,
                escape(feedback_txt),
            )

        if len(shots) > 20:
            stbl.add_row("…", "…", f"[dim]+{len(shots)-20} more events[/]", "", "", "")

        console.print(stbl)
        console.print()

    # ── Strengths / issues ────────────────────────────────────────────────
    cols = []
    if summary.get("strengths"):
        s_tbl = Table.grid(padding=(0, 1))
        s_tbl.add_column()
        for s in summary["strengths"]:
            s_tbl.add_row(f"[good]▸[/] {escape(s)}")
        cols.append(Panel(
            s_tbl,
            title="[good]💪  Strengths[/]",
            border_style="green",
            padding=(0, 1),
        ))

    if summary.get("top_issues"):
        i_tbl = Table.grid(padding=(0, 1))
        i_tbl.add_column()
        for i in summary["top_issues"]:
            i_tbl.add_row(f"[bad]▸[/] {escape(i)}")
        cols.append(Panel(
            i_tbl,
            title="[bad]⚠  Top Issues[/]",
            border_style="red",
            padding=(0, 1),
        ))

    if cols:
        console.print(Columns(cols, equal=True))
        console.print()

    if summary.get("priority_drill"):
        console.print(Panel(
            f"[white]{escape(summary['priority_drill'])}[/]",
            title="[accent]🎯  Next Session Focus[/]",
            border_style="bright_blue",
            padding=(0, 2),
        ))
        console.print()

    # ── Output paths ──────────────────────────────────────────────────────
    out_tbl = Table.grid(padding=(0, 2))
    out_tbl.add_column(style="dim", justify="right")
    out_tbl.add_column(style="bold white")
    out_tbl.add_row("JSON  →", str(events_path))
    if video_out:
        out_tbl.add_row("Video →", str(video_out))

    console.print(Panel(
        out_tbl,
        title="[accent]📁  Output Files[/]",
        border_style="bright_blue",
        padding=(0, 2),
    ))
    console.print()
    console.print("[good]✅  Analysis complete![/]\n")


def _stat_card(label: str, value: str) -> Panel:
    return Panel(
        Align.center(Text.from_markup(f"[bold white]{value}[/]\n[dim]{label}[/]")),
        border_style="bright_blue",
        padding=(0, 2),
        expand=False,
    )


# ── Main pipeline: local ──────────────────────────────────────────────────────

def _run_local(args):
    _banner()

    video_path = pathlib.Path(args.video).resolve()
    duration_s = _validate_video(video_path, events_only=args.events_only)
    base       = video_path.stem

    # ── Player detection ──────────────────────────────────────────────────
    player_focus = None
    if not args.skip_detection:
        player_focus = _detect_players_step(video_path)

    # ── Gemini analysis ───────────────────────────────────────────────────
    result = _run_analysis(video_path, args.model, args.strict,
                           player_focus, duration_s)

    events_path = ROOT / "events" / f"{base}.json"
    _save_json(events_path, result)

    if args.events_only:
        console.print(Rule("[dim]--events-only: skipping render[/]", style="dim"))
        _show_results(result, events_path, None)
        return

    # ── Render ────────────────────────────────────────────────────────────
    video_out = None

    # ── Display results ───────────────────────────────────────────────────
    _show_results(result, events_path, video_out)


# ── Main pipeline: API-backed ─────────────────────────────────────────────────

def _run_api(args):
    try:
        import requests
    except ImportError:
        console.print("[bad]✗  'requests' package not installed.[/]  pip install requests")
        sys.exit(1)

    _banner()

    video_path = pathlib.Path(args.video).resolve()
    duration_s = _validate_video(video_path, events_only=args.events_only)
    from core.chunker import CHUNK_THRESHOLD_S
    should_chunk = duration_s >= CHUNK_THRESHOLD_S
    eta_min_s, eta_max_s = _estimate_analysis_eta_range(duration_s, should_chunk=should_chunk)

    api = args.api_url.rstrip("/")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console=console, transient=False,
    ) as prog:
        task = prog.add_task(f"Uploading to {api}…", total=None)
        with open(video_path, "rb") as vf:
            resp = requests.post(
                f"{api}/api/analyze",
                files={"video": (video_path.name, vf, "video/mp4")},
                data ={"model": args.model, "render": not args.events_only},
                timeout=120,
            )
        resp.raise_for_status()
        job    = resp.json()
        job_id = job["job_id"]
        prog.update(task, description=f"Job {job_id[:8]}… queued", completed=1, total=1)

    console.print()

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console, transient=False,
    ) as prog:
        started_at = time.time()
        task = prog.add_task(
            _with_eta("Processing…", started_at, eta_min_s, eta_max_s),
            total=100,
        )
        while True:
            time.sleep(3)
            j   = requests.get(f"{api}/api/jobs/{job_id}", timeout=10).json()
            pct = j.get("progress", 0)
            msg = j.get("message", "")
            prog.update(
                task,
                completed=pct,
                description=_with_eta(msg[:60] or "Processing…", started_at, eta_min_s, eta_max_s),
            )
            if j["status"] == "done":
                prog.update(task, completed=100, description="Done!")
                break
            if j["status"] == "error":
                console.print(f"\n[bad]✗  Server error:[/] {j.get('error')}")
                sys.exit(1)

    result      = requests.get(f"{api}/api/events/{job_id}", timeout=10).json()
    events_path = ROOT / "events" / f"{video_path.stem}.json"
    _save_json(events_path, result)

    video_out = None
    if not args.events_only:
        out = pathlib.Path(args.output) if args.output else \
              _downloads_dir() / f"{video_path.stem}_analyzed.mp4"
        console.print(f"\n[dim]Downloading video → {out} …[/]")
        with requests.get(f"{api}/api/download/{job_id}", stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(out, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        video_out = out

    requests.delete(f"{api}/api/jobs/{job_id}", timeout=10)
    _show_results(result, events_path, video_out)


# ── argparse ──────────────────────────────────────────────────────────────────

def main():
    import argparse

    from core.config import GEMINI_MODEL

    parser = argparse.ArgumentParser(
        prog="coachai",
        description="CoachAI — Multi-sport AI video analyzer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python cli/main.py analyze video.mp4\n"
            "  python cli/main.py analyze video.mp4 --skip-detection\n"
            "  python cli/main.py analyze video.mp4 --events-only\n"
            "  python cli/main.py analyze video.mp4 --api-url http://localhost:8000\n"
        ),
    )
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("analyze", help="Detect players, analyze video, render overlay.")
    p.add_argument("video",             help="Path to the video file.")
    p.add_argument("-o", "--output",    default=None,
                   help="Output .mp4 path (default: ~/Downloads/<name>_analyzed.mp4).")
    p.add_argument("-m", "--model",     default=GEMINI_MODEL,
                   help="Gemini model ID.")
    p.add_argument("--api-url",         default=None,
                   help="Route through a running backend (e.g. http://localhost:8000).")
    p.add_argument("--events-only",     action="store_true",
                   help="Skip video render – only produce the JSON.")
    p.add_argument("--skip-detection",  action="store_true",
                   help="Skip player detection and analyse all players together.")
    p.add_argument("--strict",          action="store_true",
                   help="Abort on Gemini validation warnings (local mode only).")
    p.set_defaults(func=lambda a: _run_api(a) if a.api_url else _run_local(a))

    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        sys.exit(0)
    args.func(args)


if __name__ == "__main__":
    main()
