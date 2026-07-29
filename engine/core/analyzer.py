"""
analyzer.py — Pipeline orchestrator.

Thin coordinator that wires together video_io, tracking, gemini_client,
cache, dedup, jobs, renderer, and storage. All business logic lives in
the extracted modules.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import cv2

from core.cache import compute_video_hash, get_cached_analysis, set_cached_analysis
from core.dedup import deduplicator
from core.errors import EngineError, VideoExpiredError
from core.gemini_client import call_gemini, normalize_gemini_result
from core.jobs import update_job, transition_job, fail_job
from core.renderer import render_video
from core import storage
from core.tracking import build_active_player_tracks, compute_motion_scores
from core.video_io import (
    tmp_dir,
    preprocess_video_ffmpeg,
    extract_keyframes,
)


def run_analysis(job_id: str, video_key: str, player_index: int | None) -> None:
    """Run the full analysis pipeline for a video."""
    local_path: str | None = None
    preprocessed_path = ""
    output_path: str | None = None
    cleanup_preprocessed = False
    dedup_key = ""
    try:
        local_path = storage.download_video_to_tmp(video_key)
        preprocessed_path = local_path

        # Check cache first
        video_hash = compute_video_hash(local_path)
        cached_result = get_cached_analysis(video_hash, player_index)
        if cached_result is not None:
            # Normalize cached results that may have old Gemini format
            if "shots" in cached_result and "shot_events" not in cached_result:
                cached_result = normalize_gemini_result(cached_result)
            logging.info(json.dumps({
                "type": "cache_hit",
                "video_hash": video_hash,
                "player_index": player_index,
                "job_id": job_id,
            }))
            # Must transition through valid state path: uploading -> scanning -> analyzing -> completed
            transition_job(job_id, "scanning")
            transition_job(job_id, "analyzing")
            update_job(job_id, summary=cached_result)
            transition_job(job_id, "completed")
            return

        logging.info(json.dumps({
            "type": "cache_miss",
            "video_hash": video_hash,
            "player_index": player_index,
            "job_id": job_id,
        }))

        # Deduplication: check if same video is being analyzed
        dedup_key = f"{video_hash}:{player_index}"
        if deduplicator.is_pending(dedup_key):
            logging.info(f"[Analyzer] Deduplication: waiting for existing analysis of {video_hash}")
            _wait_start = time.time()
            while deduplicator.is_pending(dedup_key) and (time.time() - _wait_start) < 300:
                time.sleep(2)
                cached_result = get_cached_analysis(video_hash, player_index)
                if cached_result is not None:
                    transition_job(job_id, "scanning")
                    transition_job(job_id, "analyzing")
                    update_job(job_id, summary=cached_result)
                    transition_job(job_id, "completed")
                    return

        # Mark this video as being analyzed (for dedup)
        deduplicator.mark_pending(dedup_key)

        # State: scanning (extracting frames and detecting players)
        transition_job(job_id, "scanning")
        preprocessed_path = preprocess_video_ffmpeg(local_path)
        cleanup_preprocessed = preprocessed_path != local_path

        # Run keyframe extraction (CPU-bound) - returns frame cache
        loop = asyncio.new_event_loop()
        try:
            keyframes, fps, _frame_count, frame_cache = loop.run_until_complete(
                asyncio.to_thread(extract_keyframes, preprocessed_path)
            )

            cap = cv2.VideoCapture(preprocessed_path)
            try:
                video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            finally:
                cap.release()
            video_duration = _frame_count / fps if _frame_count > 0 and fps > 0 else 90.0

            # Run detection and motion scoring in parallel (both use frame cache)
            active_tracks, motion_scores = loop.run_until_complete(
                asyncio.gather(
                    asyncio.to_thread(build_active_player_tracks, local_path, keyframes, player_index, frame_cache),
                    asyncio.to_thread(compute_motion_scores, local_path, keyframes, frame_cache)
                )
            )
        finally:
            # Shut down the default executor to prevent thread leak (Python 3.9-3.11)
            default_executor = loop._default_executor
            loop.close()
            if default_executor is not None:
                default_executor.shutdown(wait=False)

        # Free cached frames (~90MB) now that tracking is done
        frame_cache.clear()

        # Combine motion scores with tracks
        for track in active_tracks:
            fi = track["frame_index"]
            motion = motion_scores.get(fi, 0.5)
            visibility = track.get("visibility", 0.5)
            track["motion_score"] = motion
            track["composite_score"] = 0.4 * visibility + 0.6 * motion

        # State: analyzing (calling Gemini)
        transition_job(job_id, "analyzing")
        frame_budget = min(20, len(active_tracks))
        best_for_gemini = sorted(active_tracks, key=lambda t: t["composite_score"], reverse=True)[:frame_budget]
        logging.info(f"[Analyzer] Selected {len(best_for_gemini)}/{len(active_tracks)} frames (budget={frame_budget})")
        for i, t in enumerate(best_for_gemini[:5]):
            logging.debug(f"  Frame {i}: ts={t['timestamp']}s visibility={t.get('visibility', 0):.2f} motion={t.get('motion_score', 0):.2f} composite={t.get('composite_score', 0):.2f}")

        gemini_result = call_gemini(
            best_for_gemini,
            video_duration=video_duration,
            video_fps=fps,
            video_width=video_width,
            video_height=video_height,
            player_index=player_index,
            video_path=preprocessed_path,
        )

        # Normalize Gemini output to match frontend type contract
        gemini_result = normalize_gemini_result(gemini_result)

        # Cache the result
        set_cached_analysis(video_hash, gemini_result, player_index)

        logging.info(json.dumps({
            "type": "analysis_complete",
            "video_hash": video_hash,
            "player_index": player_index,
            "job_id": job_id,
            "form_score": gemini_result.get("form_score"),
            "frames_analyzed": len(best_for_gemini),
        }))

        # Store analysis result
        update_job(job_id, summary=gemini_result)

        # State: rendering (annotating video)
        transition_job(job_id, "rendering")
        output_path = str(tmp_dir() / f"{job_id}_annotated.mp4")
        render_video(
            video_path=local_path,
            output_path=output_path,
            analysis_result=gemini_result,
            active_player_landmarks_per_frame=active_tracks,
            fps=fps,
        )

        result_key = storage.upload_result_video(output_path, job_id)
        output_path = None

        # State: completed
        transition_job(
            job_id,
            "completed",
            video_key=result_key,
            video_path=storage.get_local_file_path(result_key) if storage.is_local_backend() else None,
        )
    except EngineError as exc:
        fail_job(job_id, exc)
    except FileNotFoundError:
        fail_job(job_id, VideoExpiredError())
    except Exception:
        fail_job(job_id, EngineError(
            code="INTERNAL_ERROR",
            message="Unexpected analysis error.",
            retryable=True,
        ))
    finally:
        # Clear dedup entry so other threads can proceed
        deduplicator.mark_done(dedup_key)
        if cleanup_preprocessed:
            try:
                Path(preprocessed_path).unlink(missing_ok=True)
            except Exception:
                pass
        if local_path and os.path.exists(local_path):
            try:
                os.unlink(local_path)
            except Exception:
                pass
        if output_path and os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except Exception:
                pass
