import cv2
import numpy as np
import os
import time
import json
import sys
from typing import Any

import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)
from core.player_tracker import score_frames, match_player_to_skeleton

from core.utils   import timestamp_to_frame, get_video_props
from core.overlay import (
    get_animation_color,
    draw_player_label,
    draw_stats,
    draw_feedback,
    draw_form_score,
    draw_form_breakdown,
    draw_session_summary,
)

# Path to the pose-landmarker model (downloaded once alongside the project)
_MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                           'pose_landmarker_lite.task')


class SportsAnalyzer:
    """
    Parameters
    ----------
    sport_config   : dict  — loaded from sports/<sport>.json
    event_data     : dict  — loaded from events/<session>.json
    process_video  : str   — path to low-res video for MediaPipe processing
    display_video  : str   — path to high-res video for final output
    output_path    : str   — path for the rendered output video
    preview        : bool  — whether to show a live OpenCV window
    """

    def __init__(
        self,
        sport_config:  dict,
        event_data:    dict,
        process_video: str,
        display_video: str,
        output_path:   str  = 'final.mp4',
        preview:       bool = False,
    ):
        self.cfg          = sport_config
        self.events       = event_data
        self.process_path = process_video
        self.display_path = display_video
        self.output_path  = output_path
        self.preview      = preview

        self.player_name = event_data.get('player_name', 'Player')

        # Colour shortcuts (BGR tuples from config)
        self.col_primary  = tuple(self.cfg['colors']['primary'])
        self.col_positive = tuple(self.cfg['colors']['positive'])
        self.col_negative = tuple(self.cfg['colors']['negative'])
        self.col_neutral  = tuple(self.cfg['colors']['neutral'])

        self.anim_duration = self.cfg.get('animation_duration_seconds', 1.25)
        self.feedback_secs = self.cfg.get('feedback_display_seconds', 4)
        self.summary_secs  = self.cfg.get('summary_duration_seconds', 6)

        # Runtime state
        self.last_shot_time = None
        self.last_result    = None

        self._prepare_events()

    # ── Internal helpers ──────────────────────────────────────────────────

    def _prepare_events(self):
        """Pre-compute frame numbers and feedback windows for every event."""
        tmp = cv2.VideoCapture(self.process_path)
        fps = int(tmp.get(cv2.CAP_PROP_FPS))
        tmp.release()

        for ev in self.events['shots']:
            ev['frame_number']       = timestamp_to_frame(ev['timestamp_of_outcome'], fps)
            ev['feedback_end_frame'] = ev['frame_number'] + (self.feedback_secs * fps)

    def _is_positive(self, result: str) -> bool:
        return result in self.cfg['events']['positive']

    def _build_stats_list(self) -> list:
        """
        Build a list of stat dicts for draw_stats().
        Each entry: {'label': str, 'value': int, 'highlight': bool}.
        """
        stats_out = []
        for stat_cfg in self.cfg['stats']:
            key   = stat_cfg['key']
            label = stat_cfg['label']
            value = self._latest_values.get(key, 0)

            highlight = (
                self.last_result is not None
                and self.last_result == stat_cfg.get('event_type')
                and self.last_shot_time is not None
            )
            stats_out.append({
                'label':     label,
                'value':     value,
                'highlight': highlight,
            })
        return stats_out

    # ── Main entry point ──────────────────────────────────────────────────

    def run(self):
        # Check model file exists
        if not os.path.exists(_MODEL_PATH):
            print(f'ERROR: Pose landmarker model not found at {_MODEL_PATH}')
            print('Download it with:')
            print('  wget -O pose_landmarker_lite.task '
                  'https://storage.googleapis.com/mediapipe-models/'
                  'pose_landmarker/pose_landmarker_lite/float16/latest/'
                  'pose_landmarker_lite.task')
            return

        # Open both video captures
        p_cap = cv2.VideoCapture(self.process_path)
        d_cap = cv2.VideoCapture(self.display_path)

        # ── Validate that both videos can be read ─────────────────────────
        errors = []
        if not p_cap.isOpened():
            if not os.path.isfile(self.process_path):
                errors.append(f'Process video not found: {self.process_path}')
            else:
                errors.append(
                    f'Cannot open process video (codec issue?): {self.process_path}'
                )
        if not d_cap.isOpened():
            if not os.path.isfile(self.display_path):
                errors.append(f'Display video not found: {self.display_path}')
            else:
                errors.append(
                    f'Cannot open display video (codec issue?): {self.display_path}'
                )
        if errors:
            for e in errors:
                print(f'ERROR: {e}')
            print('\nHint: use the same video for both --process-video and --display-video')
            print('      e.g.  --process-video video.mp4 --display-video video.mp4')
            p_cap.release()
            d_cap.release()
            return

        p_props = get_video_props(p_cap)
        d_props = get_video_props(d_cap)

        process_fps = p_props['fps']
        display_fps = d_props['fps']
        display_w   = d_props['width']
        display_h   = d_props['height']

        print(f'  Process video : {self.process_path}  '
              f'({p_props["width"]}x{p_props["height"]} @ {process_fps}fps, '
              f'{p_props["frames"]} frames)')
        print(f'  Display video : {self.display_path}  '
              f'({display_w}x{display_h} @ {display_fps}fps, '
              f'{d_props["frames"]} frames)')

        # ── MediaPipe PoseLandmarker (Tasks API) ──────────────────────────
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=_MODEL_PATH),
            running_mode=RunningMode.VIDEO,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        pose = PoseLandmarker.create_from_options(options)

        # Video writer
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(
            self.output_path, fourcc, display_fps, (display_w, display_h),
        )

        # Frame-loop state
        last_head         = None
        frame_count       = 0
        process_every_n   = max(1, int(process_fps / 20))
        current_feedback  = None
        active_event      = None
        self._latest_values: dict = {}
        last_display_frame = None

        sport_name = self.cfg.get('display_name', 'Sport')
        print(f'[{sport_name}] Processing video → {self.output_path}')

        # ── Frame-by-frame loop ───────────────────────────────────────────
        while p_cap.isOpened() and d_cap.isOpened():
            p_ret, p_frame = p_cap.read()
            d_ret, d_frame = d_cap.read()
            if not p_ret or not d_ret:
                break

            frame_count += 1

            # ── Pose detection (throttled) ────────────────────────────────
            if frame_count % process_every_n == 0:
                rgb = cv2.cvtColor(p_frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb,
                )
                # Tasks API requires a monotonically increasing timestamp in ms
                timestamp_ms = int((frame_count / process_fps) * 1000)
                result = pose.detect_for_video(mp_image, timestamp_ms)

                if result.pose_landmarks and len(result.pose_landmarks) > 0:
                    # Landmark 0 = nose (top of head)
                    head = result.pose_landmarks[0][0]
                    last_head = (
                        int(head.x * display_w),
                        int(head.y * display_h),
                    )

            # ── Event scanning ────────────────────────────────────────────
            current_feedback = None
            active_event     = None

            for ev in self.events['shots']:
                if ev['frame_number'] > frame_count:
                    continue

                # Update latest stat values from every past event
                for stat_cfg in self.cfg['stats']:
                    k = stat_cfg['key']
                    if k in ev:
                        self._latest_values[k] = ev[k]

                # Trigger animation on exact frame
                if ev['frame_number'] == frame_count:
                    self.last_shot_time = time.time()
                    self.last_result    = ev['result']

                # Show feedback window + track active event
                if ev['frame_number'] <= frame_count <= ev['feedback_end_frame']:
                    current_feedback = ev.get('feedback')
                    active_event     = ev

            # ── Animation colour ──────────────────────────────────────────
            if self.last_shot_time is not None:
                elapsed = time.time() - self.last_shot_time
                anim_color = get_animation_color(
                    elapsed,
                    self.anim_duration,
                    self._is_positive(self.last_result or ''),
                    self.col_positive,
                    self.col_negative,
                )
                if elapsed >= self.anim_duration:
                    self.last_shot_time = None
            else:
                anim_color = self.col_neutral

            # ── Draw overlays ─────────────────────────────────────────────
            # 1) Player label
            draw_player_label(d_frame, last_head, self.player_name, self.col_primary)

            # 2) Stats (top-left)
            stats = self._build_stats_list()
            draw_stats(d_frame, stats, anim_color,
                       self._is_positive(self.last_result or ''))

            # 3) Form score badge (top-right) — only during feedback window
            if active_event and active_event.get('form_score') is not None:
                draw_form_score(d_frame, active_event['form_score'], display_w)

            # 4) Form breakdown panel (right side) — only during feedback window
            if active_event and active_event.get('form_breakdown'):
                draw_form_breakdown(
                    d_frame,
                    active_event['form_breakdown'],
                    display_w,
                    display_h,
                )

            # 5) Feedback text (bottom-centre)
            draw_feedback(d_frame, current_feedback, display_w, display_h)

            # ── Write / preview ───────────────────────────────────────────
            writer.write(d_frame)
            last_display_frame = d_frame.copy()

            if self.preview:
                cv2.imshow(f'{sport_name} Analyzer', d_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break

        # ── Session summary (appended frames at the end) ──────────────────
        session_summary = self.events.get('session_summary')
        if session_summary and last_display_frame is not None:
            summary_frames = int(self.summary_secs * display_fps)
            print(f'[{sport_name}] Appending {self.summary_secs}s session summary…')

            for _ in range(summary_frames):
                summary_frame = last_display_frame.copy()
                draw_session_summary(summary_frame, session_summary,
                                     display_w, display_h)
                writer.write(summary_frame)

                if self.preview:
                    cv2.imshow(f'{sport_name} Analyzer', summary_frame)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        break

        # ── Cleanup ───────────────────────────────────────────────────────
        p_cap.release()
        d_cap.release()
        pose.close()
        writer.release()
        if self.preview:
            cv2.destroyAllWindows()

        print(f'[{sport_name}] Done. Output saved to {self.output_path}')


PHASE2_MULTIFRAME_ANALYSIS = """\
You are an elite sports biomechanics analyst.
Analyze the uploaded video for MULTIPLE named players using the provided player
references and keyframe-to-skeleton assignments.

Rules:
1) Focus only on the player labels provided in PLAYER_CONTEXT_JSON.
2) Track each player's actions separately across the full video.
3) Return strict JSON only (no markdown).
4) Output must be keyed by player label.
5) For each player, use the same schema as single-player analysis:
   {
     "sport": "...",
     "player_name": "...",
     "session_date": "...",
     "video_duration_seconds": <number>,
     "shots": [...],
     "session_summary": {...}
   }

Final output schema:
{
  "<player label>": { ...single-player schema... },
  "<player label>": { ...single-player schema... }
}
"""


def analyze(
    video_path: str,
    model_name: str = 'gemini-2.5-flash',
    strict: bool = False,
    player_focus: dict | None = None,
    chunk_info: dict | None = None,
    players: list[dict[str, Any]] | None = None,
) -> dict:
    """
    Main analysis entrypoint.

    - If players is None/empty, executes the existing single-player flow.
    - If players is provided, runs multi-player matching and returns a dict
      keyed by player label.
    """
    from core.gemini import analyze_video

    if not players:
        return analyze_video(
            video_path=video_path,
            model_name=model_name,
            strict=strict,
            player_focus=player_focus,
            chunk_info=chunk_info,
        )

    try:
        scored_keyframes = score_frames(video_path)
    except Exception as exc:
        print(f"[analyze] score_frames failed ({exc}); continuing without keyframe matches.", file=sys.stderr)
        scored_keyframes = []
    keyframe_matches = _build_keyframe_matches(players, scored_keyframes)
    multi_prompt = _build_multiplayer_prompt(players, keyframe_matches)

    multi_result = _analyze_video_with_prompt(
        video_path=video_path,
        prompt=multi_prompt,
        model_name=model_name,
        strict=strict,
    )

    keyed = _coerce_keyed_output(multi_result, players)
    if keyed is not None:
        return keyed

    # Fallback for robustness: run the known single-player path per label.
    fallback: dict[str, dict] = {}
    for player in players:
        label = str(player.get('label') or f"Player {player.get('player_index', '?')}")
        position = _position_hint_from_matches(label, keyframe_matches)
        fallback[label] = analyze_video(
            video_path=video_path,
            model_name=model_name,
            strict=strict,
            player_focus={
                'id': int(player.get('player_index', 0)) + 1,
                'position': position,
            },
            chunk_info=chunk_info,
        )
    return fallback


def _build_keyframe_matches(players: list[dict[str, Any]], scored_keyframes: list) -> dict:
    payload: dict[str, Any] = {"keyframes": []}

    for frame in scored_keyframes:
        frame_item = {
            "frame_index": frame.frame_index,
            "timestamp_s": round(frame.timestamp_s, 3),
            "score": frame.total_score,
            "frame_width": frame.frame_width,
            "frame_height": frame.frame_height,
            "matches": [],
        }

        for player in players:
            label = str(player.get('label') or f"Player {player.get('player_index', '?')}")
            bbox = player.get('bbox') or {}
            matched_idx = match_player_to_skeleton(
                reference_bbox=bbox,
                detected_skeletons=frame.detected_skeletons,
                frame_width=frame.frame_width,
                frame_height=frame.frame_height,
            )

            if matched_idx >= 0:
                skeleton = frame.detected_skeletons[matched_idx]
                match_conf = float(skeleton.get('confidence', 0.0))
                centroid = skeleton.get('centroid')
            else:
                match_conf = 0.0
                centroid = None

            frame_item["matches"].append({
                "player_label": label,
                "player_index": player.get('player_index'),
                "matched_skeleton_index": matched_idx,
                "match_confidence": round(match_conf, 4),
                "matched_centroid": centroid,
            })

        payload["keyframes"].append(frame_item)

    return payload


def _build_multiplayer_prompt(players: list[dict[str, Any]], keyframe_matches: dict) -> str:
    ctx = {
        "players": [
            {
                "player_index": p.get("player_index"),
                "label": p.get("label"),
                "bbox": p.get("bbox"),
            }
            for p in players
        ],
        "keyframe_matches": keyframe_matches,
    }
    return f"{PHASE2_MULTIFRAME_ANALYSIS}\n\nPLAYER_CONTEXT_JSON:\n{json.dumps(ctx, indent=2)}"


def _analyze_video_with_prompt(
    video_path: str,
    prompt: str,
    model_name: str,
    strict: bool,
) -> dict:
    import os
    import json as _json
    import time as _time
    from core import gemini as gemini_core
    from core.validator import validate_analysis

    gemini_core._ensure_genai()

    ext = os.path.splitext(video_path)[1].lower()
    mime_type = gemini_core._MIME_TYPES.get(ext, 'video/mp4')

    video_file = gemini_core.genai.upload_file(path=video_path, mime_type=mime_type)
    while video_file.state.name == 'PROCESSING':
        _time.sleep(5)
        video_file = gemini_core.genai.get_file(video_file.name)

    if video_file.state.name == 'FAILED':
        raise RuntimeError(f'Gemini video processing failed. State: {video_file.state}')

    model = gemini_core.genai.GenerativeModel(model_name)
    response = model.generate_content(
        [video_file, prompt],
        generation_config=gemini_core.genai.GenerationConfig(
            response_mime_type='application/json',
            temperature=0.1,
        ),
    )

    raw_text = gemini_core._clean_json_text(response.text)
    result = _json.loads(raw_text)

    # Clean + validate per player if output is keyed by label.
    if isinstance(result, dict):
        if 'players' in result and isinstance(result['players'], dict):
            for _, player_result in result['players'].items():
                if isinstance(player_result, dict):
                    gemini_core._clean_analysis(player_result)
                    warnings = validate_analysis(player_result)
                    if warnings and strict:
                        raise ValueError(
                            f'{len(warnings)} validation error(s) in multi-player response.'
                        )
        else:
            for _, maybe_player_result in result.items():
                if isinstance(maybe_player_result, dict) and 'shots' in maybe_player_result:
                    gemini_core._clean_analysis(maybe_player_result)
                    warnings = validate_analysis(maybe_player_result)
                    if warnings and strict:
                        raise ValueError(
                            f'{len(warnings)} validation error(s) in multi-player response.'
                        )

    try:
        gemini_core.genai.delete_file(video_file.name)
    except Exception:
        pass

    return result


def _coerce_keyed_output(multi_result: Any, players: list[dict[str, Any]]) -> dict[str, dict] | None:
    if not isinstance(multi_result, dict):
        return None

    labels = [str(p.get('label') or f"Player {p.get('player_index', '?')}") for p in players]

    if 'players' in multi_result and isinstance(multi_result['players'], dict):
        out: dict[str, dict] = {}
        for label in labels:
            val = multi_result['players'].get(label)
            if isinstance(val, dict):
                out[label] = val
        if out:
            return out

    out: dict[str, dict] = {}
    for label in labels:
        val = multi_result.get(label)
        if isinstance(val, dict):
            out[label] = val
    if out:
        return out

    return None


def _position_hint_from_matches(label: str, keyframe_matches: dict) -> str:
    for frame in keyframe_matches.get('keyframes', []):
        for item in frame.get('matches', []):
            if item.get('player_label') == label and item.get('matched_centroid'):
                cx, cy = item['matched_centroid']
                fw = max(1.0, float(frame.get('frame_width', 1.0)))
                fh = max(1.0, float(frame.get('frame_height', 1.0)))
                nx = float(cx) / fw
                ny = float(cy) / fh
                x_hint = 'left' if nx < 0.33 else 'right' if nx > 0.66 else 'center'
                y_hint = 'top' if ny < 0.33 else 'bottom' if ny > 0.66 else 'middle'
                if y_hint == 'middle':
                    return f'{x_hint} side'
                return f'{y_hint}-{x_hint}'
    return 'center of frame'
