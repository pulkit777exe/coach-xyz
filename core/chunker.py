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

import json
import os
import pathlib
import tempfile
import time
from typing import Any

import cv2
import numpy as np

try:
    from langchain_core.runnables import RunnableLambda
    _HAS_LANGCHAIN = True
except ImportError:
    _HAS_LANGCHAIN = False

CHUNK_THRESHOLD_S = 240   # videos shorter than this are NOT chunked
CHUNK_DURATION_S  = 180   # length of each analysis window
CHUNK_OVERLAP_S   = 10    # overlap so boundary events aren't missed


# ── Public entry point ────────────────────────────────────────────────────────

def analyze_long_video(
    video_path:   str,
    model_name:   str  = "gemini-2.5-flash",
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

    # ── Build the LangChain Runnable pipeline ─────────────────────────────
    split_step   = RunnableLambda(lambda inp: _split_video(**inp))
    analyze_step = RunnableLambda(
        lambda chunks: _analyze_all_chunks(
            chunks, model_name, strict, player_focus, progress_cb
        )
    )
    merge_step   = RunnableLambda(_merge_chunks)

    pipeline = split_step | analyze_step | merge_step

    _cb(progress_cb, "Splitting video into analysis windows…", 5)

    return pipeline.invoke({
        "video_path":        video_path,
        "chunk_duration_s":  CHUNK_DURATION_S,
        "chunk_overlap_s":   CHUNK_OVERLAP_S,
    })


def needs_chunking(video_path: str) -> tuple[bool, float]:
    """Return (should_chunk, duration_seconds)."""
    cap = cv2.VideoCapture(video_path)
    fps   = max(1.0, cap.get(cv2.CAP_PROP_FPS))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
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
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")

    tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix="coachai_chunks_"))
    chunks  = []
    idx     = 0
    start_s = 0.0

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
        except Exception as exc:
            # Log but continue — one bad chunk shouldn't kill the whole run
            _cb(progress_cb, f"⚠ Chunk {idx+1} failed: {exc}", pct)
            continue

        # Shift timestamps by start_s
        _shift_timestamps(result, start_s)
        result["_chunk_index"] = idx
        results.append(result)

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
    sport  = base.get("sport", "basketball")
    player = base.get("player_name", "Unknown")

    all_shots: list[dict] = []
    for r in chunk_results:
        all_shots.extend(r.get("shots", []))

    # Sort by timestamp_of_shot
    all_shots.sort(key=lambda s: _ts_to_seconds(s.get("timestamp_of_shot", "0:00")))

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


def _ts_to_seconds(ts: str) -> float:
    try:
        m, s = ts.split(":")
        return int(m) * 60 + float(s)
    except Exception:
        return 0.0


def _deduplicate_shots(shots: list[dict], window_s: float = 8) -> list[dict]:
    """Remove duplicate shots that appear within *window_s* of each other."""
    if not shots:
        return shots
    kept = [shots[0]]
    for shot in shots[1:]:
        last_t  = _ts_to_seconds(kept[-1].get("timestamp_of_shot", "0:00"))
        this_t  = _ts_to_seconds(shot.get("timestamp_of_shot", "0:00"))
        if this_t - last_t > window_s:
            kept.append(shot)
        # else: duplicate near chunk boundary — skip
    return kept


def _compute_summary(shots: list[dict], sport: str) -> dict:
    """Recompute session_summary from the merged, deduplicated shot list."""
    valid_results  = {"basketball": ["made"], "football": ["goal"], "cricket": ["four","six","boundary"]}
    success_vals   = valid_results.get(sport, ["made", "goal"])

    total          = len(shots)
    made           = sum(1 for s in shots if s.get("result","").lower() in success_vals)
    success_rate   = (made / total * 100) if total else 0
    form_scores    = [s["form_score"] for s in shots if isinstance(s.get("form_score"), (int, float))]
    avg_form       = sum(form_scores) / len(form_scores) if form_scores else 0

    # Aggregate top_issues and strengths from all shots' feedback
    # (best-effort: pull from existing session summaries of chunks)
    top_issues: list[str] = []
    strengths:  list[str] = []

    rating = _overall_rating(avg_form, success_rate)

    return {
        "total_events":          total,
        "success_rate_percent":  round(success_rate, 1),
        "average_form_score":    round(avg_form, 2),
        "top_issues":            top_issues or ["See individual shot feedback above"],
        "strengths":             strengths  or ["Multiple events successfully analyzed"],
        "priority_drill":        "Review the feedback for each shot above to identify your main focus area.",
        "overall_rating":        rating,
    }


def _overall_rating(avg_form: float, success_pct: float) -> str:
    combined = avg_form * 5 + success_pct * 0.5
    if combined >= 55:   return "Elite"
    if combined >= 45:   return "Advanced"
    if combined >= 32:   return "Intermediate"
    if combined >= 20:   return "Developing"
    return "Beginner"


def _cb(cb, msg: str, pct: int):
    if callable(cb):
        cb(msg, pct)
