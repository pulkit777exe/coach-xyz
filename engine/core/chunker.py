"""
core/chunker.py — Split long videos into overlapping chunks and run
Gemini analysis on each, then merge the results.

Uses LangChain Runnable primitives so the pipeline is composable and can be
swapped to async / parallel execution later.

Pipeline
--------
  split_video → [list of chunk specs]
       ↓ (map)
  analyze_chunk  (Gemini API per chunk)
       ↓
  merge_results  →  final unified analysis dict

Threshold
---------
Videos longer than CHUNK_THRESHOLD_S (default 240 s / 4 min) are chunked.
Each chunk is CHUNK_DURATION_S (default 180 s / 3 min) with a 10-second
overlap so events near boundaries are not missed.
"""

import os
import pathlib
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

import cv2

try:
    from langchain_core.runnables import RunnableLambda  # noqa: F401
    _HAS_LANGCHAIN = True
except ImportError:
    _HAS_LANGCHAIN = False

CHUNK_THRESHOLD_S = int(os.environ.get("COACHAI_CHUNK_THRESHOLD_S", "240"))
CHUNK_DURATION_S  = int(os.environ.get("COACHAI_CHUNK_DURATION_S", "180"))
CHUNK_OVERLAP_S   = int(os.environ.get("COACHAI_CHUNK_OVERLAP_S", "10"))
CHUNK_WORKERS     = int(os.environ.get("COACHAI_CHUNK_WORKERS", "1"))

# Import from shared config
from core.config import GEMINI_MODEL, parse_timestamp


# ── Public entry point ────────────────────────────────────────────────────────

def analyze_long_video(
    video_path:   str,
    model_name:   str  = GEMINI_MODEL,
    strict:       bool = False,
    player_focus: dict | None = None,
    progress_cb         = None,   # optional callable(message: str, pct: int)
) -> dict:
    """
    Chunk *video_path* and analyze each piece with Gemini, then merge results.

    Parameters
    ----------
    video_path   : path to the source video
    model_name   : Gemini model string
    strict       : abort on validation warnings
    player_focus : dict with 'id', 'position' — restricts analysis to one player
    progress_cb  : optional fn(msg, pct) for Rich progress updates

    Returns
    -------
    Merged analysis dict in the same schema as a single analyze_video() call.
    """
    _cb(progress_cb, "Setting up LangChain chunking pipeline…", 2)

    if not _HAS_LANGCHAIN:
        raise ImportError(
            "langchain-core is required for long video analysis.\n"
            "  pip install langchain-core"
        )

    # ── Split, analyze, merge with cleanup ─────────────────────────────────
    _cb(progress_cb, "Splitting video into analysis windows…", 5)

    import shutil
    chunks = _split_video(
        video_path=video_path,
        chunk_duration_s=CHUNK_DURATION_S,
        chunk_overlap_s=CHUNK_OVERLAP_S,
    )
    try:
        analyzed = _analyze_all_chunks(chunks, model_name, strict, player_focus, progress_cb)
        return _merge_chunks(analyzed)
    finally:
        # Clean up chunk temp directories
        for chunk in chunks:
            tmp = chunk.get("tmp_dir")
            if tmp:
                try:
                    shutil.rmtree(tmp, ignore_errors=True)
                except Exception:
                    pass


def needs_chunking(video_path: str) -> tuple[bool, float]:
    """Return (should_chunk, duration_seconds)."""
    cap = cv2.VideoCapture(video_path)
    try:
        fps   = max(1.0, cap.get(cv2.CAP_PROP_FPS))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        cap.release()
    dur = total / fps
    return dur >= CHUNK_THRESHOLD_S, dur


# ── Step 1 — split ────────────────────────────────────────────────────────────

def _split_video(video_path: str, chunk_duration_s: int,
                 chunk_overlap_s: int) -> list[dict]:
    """
    Write each chunk to a temp .mp4 and return a list of chunk specs:
    {index, path, start_s, end_s, tmp_dir}
    """
    cap    = cv2.VideoCapture(video_path)
    fps    = max(1.0, cap.get(cv2.CAP_PROP_FPS))
    fw     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_s= total / fps

    step_s = chunk_duration_s - chunk_overlap_s   # how far we advance each time
    if step_s <= 0:
        raise ValueError(
            f"chunk_overlap_s ({chunk_overlap_s}) must be less than "
            f"chunk_duration_s ({chunk_duration_s})"
        )
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")

    tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix="coachai_chunks_"))
    chunks  = []
    idx     = 0
    start_s = 0.0

    try:
        while start_s < total_s:
            end_s      = min(start_s + chunk_duration_s, total_s)
            out_path   = tmp_dir / f"chunk_{idx:02d}.mp4"
            writer     = cv2.VideoWriter(str(out_path), fourcc, fps, (fw, fh))

            cap.set(cv2.CAP_PROP_POS_FRAMES, int(start_s * fps))
            frames_to_write = int((end_s - start_s) * fps)

            for _ in range(frames_to_write):
                ok, frame = cap.read()
                if not ok:
                    break
                writer.write(frame)
            writer.release()

            chunks.append({
                "index":   idx,
                "path":    str(out_path),
                "start_s": start_s,
                "end_s":   end_s,
                "total_s": total_s,
                "tmp_dir": str(tmp_dir),
            })

            idx     += 1
            start_s  = start_s + step_s
            if end_s >= total_s:
                break
    finally:
        cap.release()

    return chunks


# ── Step 2 — analyze each chunk ───────────────────────────────────────────────

def _analyze_all_chunks(
    chunks:       list[dict],
    model_name:   str,
    strict:       bool,
    player_focus: dict | None,
    progress_cb,
) -> list[dict]:
    """
    Run analyze_video() on every chunk (sequentially to respect rate limits).
    Adjusts timestamps by adding each chunk's start offset.
    """
    from core.gemini import analyze_video

    results = []
    n       = len(chunks)
    workers = max(1, min(CHUNK_WORKERS, n))

    def _run_chunk(chunk: dict):
        idx     = chunk["index"]
        start_s = chunk["start_s"]
        end_s   = chunk["end_s"]
        result = analyze_video(
            video_path   = chunk["path"],
            model_name   = model_name,
            strict       = strict,
            player_focus = player_focus,
            chunk_info   = {
                "index":          idx,
                "total_chunks":   n,
                "start_seconds":  start_s,
                "end_seconds":    end_s,
            },
        )
        _shift_timestamps(result, start_s)
        result["_chunk_index"] = idx
        return result

    if workers == 1:
        for chunk in chunks:
            idx     = chunk["index"]
            start_s = chunk["start_s"]
            end_s   = chunk["end_s"]
            pct     = 10 + int(70 * idx / n)

            _cb(progress_cb,
                f"Analyzing chunk {idx+1}/{n}  "
                f"({_fmt_ts(start_s)} → {_fmt_ts(end_s)})…",
                pct)

            try:
                result = _run_chunk(chunk)
            except Exception as exc:
                _cb(progress_cb, f"⚠ Chunk {idx+1} failed: {exc}", pct)
                continue

            results.append(result)
        return results

    _cb(progress_cb, f"Analyzing {n} chunks with {workers} workers…", 10)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(_run_chunk, chunk): chunk for chunk in chunks}
        completed = 0
        for future in as_completed(future_map):
            chunk = future_map[future]
            idx   = chunk["index"]
            completed += 1
            pct = 10 + int(70 * completed / n)
            try:
                result = future.result()
                results.append(result)
                _cb(progress_cb, f"Completed chunk {idx+1}/{n}", pct)
            except Exception as exc:
                _cb(progress_cb, f"⚠ Chunk {idx+1} failed: {exc}", pct)

    results.sort(key=lambda r: r.get("_chunk_index", 0))
    return results


def _shift_timestamps(result: dict, offset_s: float):
    """Add *offset_s* to every timestamp in the result in-place."""
    for shot in result.get("shots", []):
        for key in ("timestamp_of_shot", "timestamp_of_outcome"):
            ts = shot.get(key)
            if ts:
                shot[key] = _add_seconds(ts, offset_s)


def _add_seconds(ts_str: str, offset: float) -> str:
    """Parse 'M:SS.s' timestamp, add *offset* seconds, return same format."""
    try:
        parts  = ts_str.split(":")
        mins   = int(parts[0])
        secs   = float(parts[1])
        total  = mins * 60 + secs + offset
        m      = int(total // 60)
        s      = total % 60
        return f"{m}:{s:05.2f}"
    except Exception:
        return ts_str


def _fmt_ts(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"


# ── Step 3 — merge ────────────────────────────────────────────────────────────

def _merge_chunks(chunk_results: list[dict]) -> dict:
    """
    Merge a list of per-chunk analysis dicts into a single unified result.

    - Combines all shots, sorted by timestamp
    - Re-numbers event_index
    - Recomputes session_summary from merged shots
    - Deduplicates shots that span chunk boundaries (same timestamp ± 8 s)
    """
    if not chunk_results:
        raise ValueError("All chunks failed — no results to merge.")

    # Use the first successful result as the base for metadata
    base   = chunk_results[0]
    sport  = base.get("sport", "unknown")
    player = base.get("player_name", "Unknown")

    all_shots: list[dict] = []
    for r in chunk_results:
        all_shots.extend(r.get("shots", []))

    # Sort by timestamp_of_shot
    all_shots.sort(key=lambda s: parse_timestamp(s.get("timestamp_of_shot", "0:00")))

    # Deduplicate shots within 8 s of each other (boundary overlap artefacts)
    deduped = _deduplicate_shots(all_shots, window_s=8)

    # Re-number event_index
    for n, shot in enumerate(deduped, start=1):
        shot["event_index"] = n

    session_summary = _compute_summary(deduped, sport)

    return {
        "sport":                    sport,
        "player_name":              player,
        "session_date":             base.get("session_date"),
        "video_duration_seconds":   chunk_results[-1].get("video_duration_seconds", 0),
        "shots":                    deduped,
        "session_summary":          session_summary,
    }


def _deduplicate_shots(shots: list[dict], window_s: float = 8) -> list[dict]:
    """Remove duplicate shots that appear within *window_s* of each other."""
    if not shots:
        return shots
    kept = [shots[0]]
    for shot in shots[1:]:
        last_t  = parse_timestamp(kept[-1].get("timestamp_of_shot", "0:00"))
        this_t  = parse_timestamp(shot.get("timestamp_of_shot", "0:00"))
        if this_t - last_t > window_s:
            kept.append(shot)
        # else: duplicate near chunk boundary — skip
    return kept


def _compute_summary(shots: list[dict], sport: str) -> dict:
    """Recompute session_summary from the merged, deduplicated shot list."""
    valid_results  = {"basketball": ["made"], "football": ["goal"], "cricket": ["four","six","boundary"], "tennis": ["winner","ace"], "baseball": ["hit","home_run"], "hockey": ["goal"]}
    success_vals   = valid_results.get(sport, ["made", "goal"])

    total          = len(shots)
    made           = sum(1 for s in shots if s.get("result","").lower() in success_vals)
    success_rate   = (made / total * 100) if total else 0
    form_scores    = [s["form_score"] for s in shots if isinstance(s.get("form_score"), (int, float))]
    avg_form       = sum(form_scores) / len(form_scores) if form_scores else 0

    # Aggregate top_issues and strengths from shots' form_breakdown
    issue_counts: dict[str, int] = {}
    strength_counts: dict[str, int] = {}
    for s in shots:
        breakdown = s.get("form_breakdown")
        if isinstance(breakdown, dict):
            for criterion, rating in breakdown.items():
                label = criterion.replace("_", " ").title()
                if rating in ("needs_work", "poor"):
                    issue_counts[label] = issue_counts.get(label, 0) + 1
                elif rating in ("good", "excellent"):
                    strength_counts[label] = strength_counts.get(label, 0) + 1

    # Sort by frequency, take top items
    top_issues = [k for k, _ in sorted(issue_counts.items(), key=lambda x: -x[1])[:5]]
    strengths = [k for k, _ in sorted(strength_counts.items(), key=lambda x: -x[1])[:5]]

    # Build priority drill from most common issue
    if top_issues:
        priority_drill = f"Focus on improving: {top_issues[0]}"
    else:
        priority_drill = "Maintain current form and continue refining technique."

    rating = _overall_rating(avg_form, success_rate)

    return {
        "total_events":          total,
        "success_rate_percent":  round(success_rate, 1),
        "average_form_score":    round(avg_form, 2),
        "top_issues":            top_issues or ["See individual shot feedback above"],
        "strengths":             strengths  or ["Multiple events successfully analyzed"],
        "priority_drill":        priority_drill,
        "overall_rating":        rating,
    }


def _overall_rating(avg_form: float, success_pct: float) -> str:
    combined = avg_form * 5 + success_pct * 0.5
    if combined >= 55:
        return "Elite"
    if combined >= 45:
        return "Advanced"
    if combined >= 32:
        return "Intermediate"
    if combined >= 20:
        return "Developing"
    return "Beginner"


def _cb(cb, msg: str, pct: int):
    if callable(cb):
        cb(msg, pct)
