"""
analyzer.py — Pipeline orchestrator.

Thin coordinator that wires together video_io, tracking, gemini_client,
cache, dedup, jobs, renderer, and storage. All business logic lives in
the extracted modules.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import time
from pathlib import Path

import cv2
from typing import Any, Callable

from core.cache import compute_video_hash, get_cached_analysis, set_cached_analysis
from core.dedup import deduplicator
from core.errors import EngineError, VideoExpiredError, JobNotFoundError
from core.gemini_client import call_gemini, normalize_gemini_result
from core.multicam import normalize_angle_label
from core.sport_config import recommended_camera_angles
from core.stats import validate_and_correct_stats
from core.jobs import get_job, update_job, transition_job, fail_job, STATE_FLOW, InvalidStateTransition
from core.renderer import render_video
from core import storage
from core.biomechanics import attach_biomechanical_metrics, compute_injury_risk
from core.scoring import compute_weighted_scoring
from core.tracking import build_active_player_tracks, compute_motion_scores
from core.video_io import (
    tmp_dir,
    preprocess_video_ffmpeg,
    extract_keyframes,
)


def _stamp_angle(result: dict, angle: str | None) -> dict:
    """Stamp the analyzed camera perspective + next-angle guidance."""
    result["angle"] = normalize_angle_label(angle)
    result["recommended_angles"] = recommended_camera_angles(result.get("sport"))
    return result


def _stamp_provenance(result: dict) -> dict:
    """Stamp model/prompt/pack versions so a report stays explainable."""
    from datetime import datetime, timezone

    from core.config import (
        ANALYSIS_PROMPT_VERSION,
        ENGINE_VERSION,
        GEMINI_MODEL,
    )
    from core.sport_config import sport_pack_version

    sport = result.get("sport")
    result["provenance"] = {
        "engine": ENGINE_VERSION,
        "model": GEMINI_MODEL,
        "analysis_prompt": ANALYSIS_PROMPT_VERSION,
        "sport": sport,
        "sport_pack_version": sport_pack_version(sport if isinstance(sport, str) else None),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    return result


def _finalize_cached(result: dict, job_id: str, angle: str | None) -> dict:
    """Stamp a cache-hit summary and backfill findings for pre-findings cache entries."""
    _stamp_angle(result, angle)
    _stamp_provenance(result)
    if not isinstance(result.get("findings"), list):
        from core.findings import build_findings, enforce_evidence_gate

        built = build_findings(
            result.get("shot_events", []),
            result.get("sport"),
            result.get("provenance"),
            job_id,
        )
        result["findings"], _ = enforce_evidence_gate(built)
    if not isinstance(result.get("quality"), dict):
        from core.quality import quality_check

        report = quality_check(result)
        result["quality"] = report
        if report["needs_review"]:
            result["needs_review"] = True
    result["needs_review"] = bool(result.get("needs_review")) or _needs_review(
        result.get("findings")
    )
    return result


def _safe_transition_to_completed(job_id: str, cached_result: dict) -> None:
    """Transition a job to completed, handling cases where the job is already
    past earlier states (e.g. retry after long Gemini call)."""
    from core.jobs import get_job, JobNotFoundError
    try:
        current = get_job(job_id)
    except (JobNotFoundError, Exception):
        # Job doesn't exist or Redis error — just update and set completed
        update_job(job_id, summary=cached_result)
        try:
            transition_job(job_id, "completed")
        except Exception:
            pass
        return

    state = current.state
    # Completed is terminal. Failed is retryable and must route through scanning
    # before walking forward to completed.
    if state == "completed":
        update_job(job_id, summary=cached_result)
        return
    if state == "failed":
        try:
            transition_job(job_id, "scanning")
            state = "scanning"
        except Exception:
            update_job(job_id, summary=cached_result)
            return

    # Walk forward through valid transitions until we reach "completed"
    state_order: list[str] = list(STATE_FLOW)
    try:
        idx = state_order.index(state)
    except ValueError:
        # failed or unknown state — reset to scanning so we can walk forward
        try:
            transition_job(job_id, "scanning")
        except Exception:
            pass
        idx = state_order.index("scanning")

    # Transition forward through intermediate states
    for next_state in state_order[idx + 1:]:
        if next_state == "completed":
            update_job(job_id, summary=cached_result)
        try:
            transition_job(job_id, next_state)
        except Exception:
            # If transition fails, we're already past this state — continue
            pass
        if next_state == "completed":
            return

    # Fallback: just update the summary
    update_job(job_id, summary=cached_result)


def _committed_summary(job_id: str) -> dict[str, Any] | None:
    """Return a prior attempt's summary when it is a committable artifact.

    Stage-level idempotency (§18): if a previous attempt got as far as a
    valid summary, a retry must not redo the Gemini call — it resumes from
    tracking (for fresh landmarks) and reuses the committed summary.
    """
    from core.jobs import get_job as _get_job

    try:
        prior = _get_job(job_id)
    except Exception:
        return None
    summary = prior.summary
    if not isinstance(summary, dict) or not summary.get("shot_events"):
        return None
    return summary


def _rendered_key(job_id: str) -> str:
    from core.storage import result_key

    return result_key(job_id)


def _needs_review(findings: Any) -> bool:
    """True when any finding needs human review (§21 job-level flag)."""
    return bool(
        isinstance(findings, list)
        and any(isinstance(f, dict) and f.get("review_state") == "needs_review" for f in findings)
    )


@dataclasses.dataclass
class AnalysisContext:
    """Mutable state threaded through the pipeline stages.

    Each stage reads what it needs and writes its committed artifacts;
    resume is stage selection based on which artifacts already exist.
    """

    job_id: str
    video_key: str
    player_index: int | None
    angle: str | None = None
    # prepare stage
    local_path: str | None = None
    video_hash: str = ""
    dedup_key: str = ""
    # tracking stage
    preprocessed_path: str = ""
    cleanup_preprocessed: bool = False
    frame_cache: dict | None = None
    keyframes: list = dataclasses.field(default_factory=list)
    fps: float = 30.0
    frame_count: int = 0
    video_width: int = 0
    video_height: int = 0
    video_duration: float = 90.0
    active_tracks: list = dataclasses.field(default_factory=list)
    # reasoning + scoring stages
    gemini_result: dict = dataclasses.field(default_factory=dict)
    sport: str = "cricket"
    # render stage
    output_path: str | None = None


def _stage_prepare(ctx: AnalysisContext) -> str:
    """Download, hash, and short-circuit on cache/dedup.

    Returns "done" when a cached result completed the job, else "continue".
    Claims the dedup entry for the tracking stage on the continue path.
    """
    ctx.local_path = storage.download_video_to_tmp(ctx.video_key)
    ctx.preprocessed_path = ctx.local_path

    # Check cache first
    ctx.video_hash = compute_video_hash(ctx.local_path)
    cached_result = get_cached_analysis(ctx.video_hash, ctx.player_index)
    if cached_result is not None:
        # Normalize cached results that may have old Gemini format
        if "shots" in cached_result and "shot_events" not in cached_result:
            cached_result = normalize_gemini_result(cached_result)
        logging.info(json.dumps({
            "type": "cache_hit",
            "video_hash": ctx.video_hash,
            "player_index": ctx.player_index,
            "job_id": ctx.job_id,
        }))
        _safe_transition_to_completed(
            ctx.job_id, _finalize_cached(cached_result, ctx.job_id, ctx.angle)
        )
        return "done"

    logging.info(json.dumps({
        "type": "cache_miss",
        "video_hash": ctx.video_hash,
        "player_index": ctx.player_index,
        "job_id": ctx.job_id,
    }))

    # Deduplication: check if same video is being analyzed
    ctx.dedup_key = f"{ctx.video_hash}:{ctx.player_index}"
    if deduplicator.is_pending(ctx.dedup_key):
        logging.info(f"[Analyzer] Deduplication: waiting for existing analysis of {ctx.video_hash}")
        _wait_start = time.time()
        while deduplicator.is_pending(ctx.dedup_key) and (time.time() - _wait_start) < 300:
            time.sleep(2)
            cached_result = get_cached_analysis(ctx.video_hash, ctx.player_index)
            if cached_result is not None:
                _safe_transition_to_completed(
                    ctx.job_id, _finalize_cached(cached_result, ctx.job_id, ctx.angle)
                )
                return "done"
        # If we exited the loop because the pending entry cleared (not timeout),
        # check cache one more time before proceeding
        if not deduplicator.is_pending(ctx.dedup_key):
            cached_result = get_cached_analysis(ctx.video_hash, ctx.player_index)
            if cached_result is not None:
                _safe_transition_to_completed(
                    ctx.job_id, _finalize_cached(cached_result, ctx.job_id, ctx.angle)
                )
                return "done"

    # Mark this video as being analyzed (for dedup)
    deduplicator.mark_pending(ctx.dedup_key)
    return "continue"


def _stage_resume_check(ctx: AnalysisContext) -> str:
    """Stage resume: reuse a committed summary, or complete directly when the
    render already survived. Returns "done", "render" (summary reused, fresh
    tracking + render still needed), or "full"."""
    resume_summary = _committed_summary(ctx.job_id)
    if resume_summary is None:
        return "full"
    if storage.get_local_file_path(_rendered_key(ctx.job_id)):
        update_job(
            ctx.job_id,
            video_key=_rendered_key(ctx.job_id),
            video_path=storage.get_local_file_path(_rendered_key(ctx.job_id)),
        )
        _safe_transition_to_completed(
            ctx.job_id, _finalize_cached(resume_summary, ctx.job_id, ctx.angle)
        )
        return "done"
    logging.info(json.dumps({
        "type": "analysis_resume",
        "job_id": ctx.job_id,
        "stage": "render",
    }))
    ctx.gemini_result = resume_summary
    return "render"


def _stage_tracking(ctx: AnalysisContext) -> None:
    """Preprocess, extract keyframes, and build scored player tracks."""
    assert ctx.local_path is not None
    # State: scanning (extracting frames and detecting players)
    transition_job(ctx.job_id, "scanning")
    ctx.preprocessed_path = preprocess_video_ffmpeg(ctx.local_path)
    ctx.cleanup_preprocessed = ctx.preprocessed_path != ctx.local_path

    # Run keyframe extraction (CPU-bound) - returns frame cache
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        keyframes, fps, _frame_count, frame_cache = loop.run_until_complete(
            asyncio.to_thread(extract_keyframes, ctx.preprocessed_path)
        )

        cap = cv2.VideoCapture(ctx.preprocessed_path)
        try:
            video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        finally:
            cap.release()
        video_duration = _frame_count / fps if _frame_count > 0 and fps > 0 else 90.0

        # Run detection and motion scoring in parallel (both use frame cache)
        active_tracks, motion_scores = loop.run_until_complete(
            asyncio.gather(
                asyncio.to_thread(
                    build_active_player_tracks,
                    ctx.local_path,
                    keyframes,
                    ctx.player_index,
                    frame_cache,
                ),
                asyncio.to_thread(compute_motion_scores, ctx.local_path, keyframes, frame_cache),
            )
        )
    finally:
        # Shut down the default executor to prevent thread leak (Python 3.9-3.11)
        default_executor = getattr(loop, '_default_executor', None)
        loop.close()
        if default_executor is not None:
            default_executor.shutdown(wait=False)

    ctx.keyframes = keyframes
    ctx.fps = fps
    ctx.frame_count = _frame_count
    ctx.video_width = video_width
    ctx.video_height = video_height
    ctx.video_duration = video_duration
    ctx.frame_cache = frame_cache

    # Combine motion scores with tracks
    for track in active_tracks:
        fi = track["frame_index"]
        motion = motion_scores.get(fi, 0.5)
        visibility = track.get("visibility", 0.5)
        track["motion_score"] = motion
        track["composite_score"] = 0.4 * visibility + 0.6 * motion
    ctx.active_tracks = active_tracks


def _stage_reasoning(ctx: AnalysisContext, resumed: bool) -> None:
    """Run the Gemini call, unless a resumed summary is already committed."""
    from concurrent.futures import ThreadPoolExecutor
    from concurrent.futures import TimeoutError as FuturesTimeoutError
    from core.config import GEMINI_ANALYSIS_TIMEOUT_S

    # State: analyzing (calling Gemini — skipped on stage resume)
    transition_job(ctx.job_id, "analyzing")
    if resumed:
        logging.info(json.dumps({
            "type": "analysis_resume",
            "job_id": ctx.job_id,
            "stage": "analyzing_skipped",
        }))
        return

    frame_budget = min(20, len(ctx.active_tracks))
    best_for_gemini = sorted(
        ctx.active_tracks, key=lambda t: t["composite_score"], reverse=True
    )[:frame_budget]
    logging.info(f"[Analyzer] Selected {len(best_for_gemini)}/{len(ctx.active_tracks)} frames (budget={frame_budget})")
    for i, t in enumerate(best_for_gemini[:5]):
        logging.debug(f"  Frame {i}: ts={t['timestamp']}s visibility={t.get('visibility', 0):.2f} motion={t.get('motion_score', 0):.2f} composite={t.get('composite_score', 0):.2f}")

    # Bound the blocking multimodal call so a hung model request fails
    # fast with a retryable error instead of wedging the worker. Runs in
    # a one-shot executor; on timeout the stray thread is abandoned (it
    # only writes the analysis cache, which is keyed and idempotent).
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="gemini") as gemini_pool:
        gemini_future = gemini_pool.submit(
            call_gemini,
            best_for_gemini,
            ctx.video_duration,
            ctx.fps,
            ctx.video_width,
            ctx.video_height,
            ctx.player_index,
            ctx.preprocessed_path,
            ctx.frame_cache,
        )
        try:
            gemini_result = gemini_future.result(timeout=GEMINI_ANALYSIS_TIMEOUT_S)
        except FuturesTimeoutError as exc:
            raise EngineError(
                code="GEMINI_TIMEOUT",
                message="AI analysis timed out. Please try again.",
                retryable=True,
            ) from exc
    ctx.gemini_result = normalize_gemini_result(gemini_result)


def _stage_scoring(ctx: AnalysisContext) -> None:
    """Deterministic post-processing: stamps, biomechanics, scoring,
    injury risk, stats, findings, cache, and the job summary write."""
    from core.findings import build_findings, enforce_evidence_gate

    gemini_result = ctx.gemini_result
    # Extract sport from Gemini result for scoring config
    sport = gemini_result.get("sport", "cricket")
    ctx.sport = sport

    # Stamp which camera perspective was analyzed + the sport's guidance
    # for the next angle, so the coach knows what to film next.
    _stamp_angle(gemini_result, ctx.angle)
    _stamp_provenance(gemini_result)

    # Attach deterministic biomechanical metrics to each shot event
    # by looking up the nearest tracked frame for each event timestamp
    shot_events = gemini_result.get("shot_events", [])
    if shot_events and ctx.active_tracks:
        attach_biomechanical_metrics(shot_events, ctx.active_tracks)

    # Compute weighted composite scoring with per-criterion rationale
    compute_weighted_scoring(shot_events, sport)

    # Compute injury-risk indicators for each shot event
    compute_injury_risk(shot_events, ctx.active_tracks)

    # Validate and correct stats from shot events
    corrected_stats = validate_and_correct_stats(gemini_result.get("shot_events", []))
    gemini_result["success_rate_percent"] = corrected_stats["success_rate_percent"]
    gemini_result["average_form_score"] = corrected_stats["average_form_score"]
    gemini_result["total_events"] = corrected_stats["total_events"]

    # Derive click-traceable findings from the final scored events (§19).
    # Runs last so findings reflect corrected scores + attached
    # biomechanics (confidence/frames are the evidence gate). The gate then
    # downgrades strong claims with no supporting frames (§21).
    gemini_result["findings"], gated = enforce_evidence_gate(
        build_findings(
            shot_events,
            sport,
            gemini_result.get("provenance"),
            ctx.job_id,
        ),
        ctx.video_duration,
    )
    if gated:
        logging.info(json.dumps({
            "type": "evidence_gate",
            "job_id": ctx.job_id,
            "downgraded": gated,
        }))
    gemini_result["needs_review"] = _needs_review(gemini_result["findings"])

    logging.info(json.dumps({
        "type": "analysis_complete",
        "video_hash": ctx.video_hash,
        "player_index": ctx.player_index,
        "job_id": ctx.job_id,
        "form_score": gemini_result.get("form_score"),
        "frames_analyzed": len(ctx.active_tracks),
    }))

    # Cache the result
    set_cached_analysis(ctx.video_hash, gemini_result, ctx.player_index)

    # Store analysis result
    update_job(ctx.job_id, summary=gemini_result)


def _stage_quality_check(ctx: AnalysisContext) -> None:
    """Pre-render quality gate: validate the scored summary, stamp `quality`,
    and force needs_review on any issue. Never blocks — a flawed analysis
    degrades to human review instead of failing the job."""
    from core.quality import quality_check

    gemini_result = ctx.gemini_result
    report = quality_check(gemini_result, ctx.video_duration)
    gemini_result["quality"] = report
    if report["needs_review"]:
        gemini_result["needs_review"] = True
    logging.info(json.dumps({
        "type": "quality_check",
        "job_id": ctx.job_id,
        "passed": report["passed"],
        "issues": report["issues"],
    }))


def _stage_render(ctx: AnalysisContext) -> None:
    """Render the annotated video, upload it, and complete the job."""
    gemini_result = ctx.gemini_result
    assert ctx.local_path is not None
    # State: rendering (annotating video)
    transition_job(ctx.job_id, "rendering")
    output_path = str(tmp_dir() / f"{ctx.job_id}_annotated.mp4")
    ctx.output_path = output_path
    render_video(
        video_path=ctx.local_path,
        output_path=output_path,
        analysis_result=gemini_result,
        active_player_landmarks_per_frame=ctx.active_tracks,
        fps=ctx.fps,
        sport=gemini_result.get("sport"),
    )

    result_key = storage.upload_result_video(output_path, ctx.job_id)
    ctx.output_path = None

    # State: completed
    transition_job(
        ctx.job_id,
        "completed",
        video_key=result_key,
        video_path=storage.get_local_file_path_or_none(result_key),
    )


def run_analysis(
    job_id: str,
    video_key: str,
    player_index: int | None,
    angle: str | None = None,
    on_stage: Callable[[str], None] | None = None,
    render: bool = True,
) -> None:
    """Run the full analysis pipeline for a video.

    Idempotent: if the job is already completed, this function returns
    immediately. Failed jobs are retried from scanning.

    on_stage (optional) reports stage boundaries to the caller — the CLI
    progress adapter. Stage names: prepare, tracking, reasoning, scoring,
    quality_check, render, done. render=False skips the render stage and
    completes straight from analyzing (CLI --events-only).
    """
    # Idempotency guard: skip if job is already being processed or completed.
    # Only allow analysis from "uploading" (new) or "failed" (retry) states.
    try:
        existing_job = get_job(job_id)
        if existing_job.state not in ("uploading", "failed"):
            logging.info(json.dumps({
                "type": "analysis_skipped",
                "reason": "job_already_in_progress",
                "job_id": job_id,
                "state": existing_job.state,
            }))
            return
    except (JobNotFoundError, Exception):
        # Job doesn't exist yet or store error — proceed with analysis
        pass

    def _emit(stage: str) -> None:
        if on_stage is not None:
            on_stage(stage)

    ctx = AnalysisContext(job_id=job_id, video_key=video_key, player_index=player_index, angle=angle)
    try:
        _emit("prepare")
        if _stage_prepare(ctx) == "done":
            _emit("done")
            return

        resume = _stage_resume_check(ctx)
        if resume == "done":
            _emit("done")
            return

        _emit("tracking")
        _stage_tracking(ctx)
        _emit("reasoning")
        _stage_reasoning(ctx, resumed=(resume == "render"))
        _emit("scoring")
        _stage_scoring(ctx)
        _emit("quality_check")
        _stage_quality_check(ctx)
        if render:
            _emit("render")
            _stage_render(ctx)
        else:
            # Events-only: the summary is already committed by the scoring
            # stage — complete without rendering. The direct jump is valid
            # from analyzing/rendering; anything earlier walks via analyzing.
            try:
                transition_job(ctx.job_id, "completed")
            except InvalidStateTransition:
                transition_job(ctx.job_id, "analyzing")
                transition_job(ctx.job_id, "completed")
        _emit("done")

    except EngineError as exc:
        logging.error(json.dumps({"type": "analysis_engine_error", "job_id": job_id, "code": exc.code, "message": exc.message}))
        fail_job(job_id, exc)
        raise
    except FileNotFoundError:
        logging.error(json.dumps({"type": "analysis_file_not_found", "job_id": job_id}))
        fail_job(job_id, VideoExpiredError())
        raise
    except Exception as exc:
        logging.error(json.dumps({
            "type": "analysis_failed",
            "job_id": job_id,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }))
        fail_job(job_id, EngineError(
            code="INTERNAL_ERROR",
            message="Unexpected analysis error.",
            retryable=True,
        ))
        raise
    finally:
        # Free cached frames (~90MB) now that tracking is done
        if ctx.frame_cache is not None:
            ctx.frame_cache.clear()
        # Clear dedup entry so other threads can proceed
        deduplicator.mark_done(ctx.dedup_key)
        # Clean up the ffmpeg-preprocessed copy (only if it differs from the
        # storage path — storage.download_video_to_tmp now returns the storage
        # path directly, so we must NOT unlink local_path itself).
        if ctx.cleanup_preprocessed and ctx.preprocessed_path and ctx.preprocessed_path != ctx.local_path:
            try:
                Path(ctx.preprocessed_path).unlink(missing_ok=True)
            except Exception:
                pass
        # NOTE: the source upload is intentionally NOT deleted here. The same
        # upload backs re-analysis (another player, another angle, retry) and
        # the session owns its lifetime — files are deleted when the session
        # is evicted (see delete_session_files in core.sessions) or by the
        # shutdown sweep. Deleting here broke every second analyze on one
        # upload with VideoExpiredError.
        # Exception: on the S3 backend local_path is a throwaway tmp copy
        # (not the stored object), so the backend discards it to avoid
        # filling /tmp. Locally this is a no-op (the stored file stays).
        storage.discard_tmp_copy(ctx.local_path)
        if ctx.output_path and os.path.exists(ctx.output_path):
            try:
                os.unlink(ctx.output_path)
            except Exception:
                pass
