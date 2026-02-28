import argparse
import base64
import json
import mimetypes
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

try:
    import google.generativeai as genai
except ImportError:
    genai = None


STAGE_NAMES = {
    0: "Uploading",
    1: "Extracting Frames",
    2: "Detecting Players",
    3: "Analyzing Technique",
    4: "Generating Feedback",
    5: "Rendering Video",
}

GEMINI_PROMPT = """
Analyze sports form in this video clip, detect sport, score 0-100, top 3 tips.
You are an elite sports performance coach. Focus on the selected player context.

Return strict JSON only with this schema:
{
  "sport": "string",
  "formScore": 0,
  "tips": ["tip 1", "tip 2", "tip 3"],
  "summary": "short coaching summary"
}

Rules:
- sport should be your best guess from the motion cues.
- formScore must be integer 0-100.
- tips must contain exactly 3 concise actionable coaching tips.
- Keep summary under 40 words.
""".strip()

WORK_DIR = Path(tempfile.gettempdir()) / "sports_video_mvp"
UPLOAD_DIR = WORK_DIR / "uploads"
OUTPUT_DIR = WORK_DIR / "outputs"
for directory in (WORK_DIR, UPLOAD_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

jobs_lock = threading.Lock()
jobs: Dict[str, Dict[str, Any]] = {}

scan_cache_lock = threading.Lock()
scan_cache: Dict[str, Dict[str, Any]] = {}


class NoPlayersDetectedError(RuntimeError):
    pass


class AnalyzeRequest(BaseModel):
    video_path: str = Field(..., description="Local path to the input video")
    player_index: Optional[int] = Field(
        default=None,
        ge=0,
        description="Optional player index returned by /scan",
    )


app = FastAPI(title="Sports Video Analysis MVP", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def stage_name(stage: int) -> str:
    return STAGE_NAMES.get(stage, "Unknown")


def get_mediapipe_solution_modules() -> Tuple[Any, Any, Any]:
    """
    Resolve Pose/Holistic modules from the classic MediaPipe Solutions API.
    """
    solutions = getattr(mp, "solutions", None)
    if solutions is None:
        raise RuntimeError(
            "MediaPipe Pose/Holistic API not found. Install a compatible version, "
            "for example: pip install mediapipe==0.10.14"
        )
    return solutions.pose, solutions.holistic, solutions.drawing_utils


def video_cache_key(video_path: str) -> str:
    abs_path = os.path.abspath(video_path)
    st = os.stat(abs_path)
    return f"{abs_path}:{st.st_mtime_ns}:{st.st_size}"


def image_to_data_url(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise RuntimeError("Could not encode preview image")
    encoded = base64.b64encode(buffer.tobytes()).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"


def strip_markdown_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def parse_json_response(text: str) -> Dict[str, Any]:
    cleaned = strip_markdown_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def normalize_summary(raw: Dict[str, Any]) -> Dict[str, Any]:
    sport = str(raw.get("sport", "unknown")).strip() or "unknown"
    score_raw = raw.get("formScore", raw.get("score", 50))
    try:
        score = int(round(float(score_raw)))
    except (TypeError, ValueError):
        score = 50
    score = max(0, min(100, score))

    tips_raw = raw.get("tips", [])
    if isinstance(tips_raw, str):
        tips = [tips_raw.strip()]
    elif isinstance(tips_raw, list):
        tips = [str(item).strip() for item in tips_raw if str(item).strip()]
    else:
        tips = []

    while len(tips) < 3:
        defaults = [
            "Improve balance and center of gravity throughout movement.",
            "Keep joints aligned and avoid collapsing posture during execution.",
            "Slow down reps in practice and focus on repeatable mechanics.",
        ]
        tips.append(defaults[len(tips)])
    tips = tips[:3]

    summary = str(raw.get("summary", "")).strip()
    return {
        "sport": sport,
        "formScore": score,
        "tips": tips,
        "summary": summary,
    }


def frame_is_clean(frame: np.ndarray) -> bool:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness = float(gray.mean())
    return blur_var >= 35.0 and brightness >= 28.0


def iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh

    ix1 = max(ax, bx)
    iy1 = max(ay, by)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    if union <= 0:
        return 0.0
    return inter / union


def clamp_bbox(
    x: int,
    y: int,
    w: int,
    h: int,
    frame_w: int,
    frame_h: int,
) -> Tuple[int, int, int, int]:
    x = max(0, min(frame_w - 1, x))
    y = max(0, min(frame_h - 1, y))
    w = max(1, min(frame_w - x, w))
    h = max(1, min(frame_h - y, h))
    return x, y, w, h


def expand_square_bbox(
    bbox: Tuple[int, int, int, int],
    frame_w: int,
    frame_h: int,
    scale: float = 1.35,
) -> Tuple[int, int, int, int]:
    x, y, w, h = bbox
    cx = x + w / 2.0
    cy = y + h / 2.0
    side = max(w, h) * scale
    nx = int(round(cx - side / 2.0))
    ny = int(round(cy - side / 2.0))
    ns = int(round(side))
    return clamp_bbox(nx, ny, ns, ns, frame_w, frame_h)


def extract_zoom_crop(frame: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
    h, w = frame.shape[:2]
    x, y, bw, bh = expand_square_bbox(bbox, w, h, scale=1.4)
    crop = frame[y : y + bh, x : x + bw]
    if crop.size == 0:
        return np.zeros((256, 256, 3), dtype=np.uint8)
    return cv2.resize(crop, (256, 256), interpolation=cv2.INTER_AREA)


def extract_bbox_from_landmarks(
    landmarks: List[Any],
    width: int,
    height: int,
    min_visibility: float,
) -> Optional[Tuple[Tuple[int, int, int, int], float]]:
    visible = [lm for lm in landmarks if lm.visibility >= min_visibility]
    if len(visible) < 8:
        return None

    xs = [lm.x for lm in visible]
    ys = [lm.y for lm in visible]
    x1 = max(0, int(min(xs) * width))
    y1 = max(0, int(min(ys) * height))
    x2 = min(width - 1, int(max(xs) * width))
    y2 = min(height - 1, int(max(ys) * height))

    bw = max(1, x2 - x1)
    bh = max(1, y2 - y1)
    confidence = float(np.mean([lm.visibility for lm in visible]))
    return (x1, y1, bw, bh), confidence


class MediaPipePlayerDetector:
    def __init__(
        self,
        min_detection_confidence: float = 0.5,
        min_visibility: float = 0.35,
    ) -> None:
        self.min_detection_confidence = min_detection_confidence
        self.min_visibility = min_visibility

        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def _propose_regions(
        self,
        frame: np.ndarray,
        max_candidates: int = 8,
    ) -> List[Tuple[int, int, int, int, float]]:
        h, w = frame.shape[:2]
        scale = 1.0
        resized = frame
        max_dim = max(w, h)
        if max_dim > 960:
            scale = 960.0 / max_dim
            resized = cv2.resize(frame, (int(w * scale), int(h * scale)))

        boxes, weights = self.hog.detectMultiScale(
            resized,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )

        proposals: List[Tuple[int, int, int, int, float]] = []
        if len(boxes) > 0:
            flat_weights = weights.flatten()
            for (x, y, bw, bh), wt in zip(boxes, flat_weights):
                gx = int(x / scale)
                gy = int(y / scale)
                gw = int(bw / scale)
                gh = int(bh / scale)
                if gw * gh < 0.01 * (w * h):
                    continue
                gx, gy, gw, gh = clamp_bbox(gx, gy, gw, gh, w, h)
                proposals.append((gx, gy, gw, gh, float(wt)))

        if not proposals:
            proposals.append((0, 0, w, h, 0.3))

        proposals.sort(key=lambda item: item[4], reverse=True)
        return proposals[:max_candidates]

    def _detect_on_region(
        self,
        frame: np.ndarray,
        proposal: Tuple[int, int, int, int, float],
        pose: Any,
        holistic: Any,
    ) -> Optional[Dict[str, Any]]:
        frame_h, frame_w = frame.shape[:2]
        x, y, bw, bh, proposal_conf = proposal
        rx, ry, rw, rh = expand_square_bbox((x, y, bw, bh), frame_w, frame_h, scale=1.18)
        crop = frame[ry : ry + rh, rx : rx + rw]
        if crop.size == 0:
            return None

        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        pose_result = pose.process(rgb)
        landmarks = None
        if pose_result and pose_result.pose_landmarks:
            landmarks = pose_result.pose_landmarks.landmark
        else:
            holistic_result = holistic.process(rgb)
            if holistic_result and holistic_result.pose_landmarks:
                landmarks = holistic_result.pose_landmarks.landmark

        if not landmarks:
            return None

        bbox_info = extract_bbox_from_landmarks(landmarks, rw, rh, self.min_visibility)
        if not bbox_info:
            return None

        (lx, ly, lw, lh), pose_conf = bbox_info
        gx, gy, gw, gh = clamp_bbox(rx + lx, ry + ly, lw, lh, frame_w, frame_h)
        merged_conf = float(np.clip(0.8 * pose_conf + 0.2 * min(1.0, proposal_conf / 1.5), 0.0, 1.0))

        return {
            "bbox": (gx, gy, gw, gh),
            "confidence": merged_conf,
            "preview": extract_zoom_crop(frame, (gx, gy, gw, gh)),
        }

    def detect_players_in_frame(
        self,
        frame: np.ndarray,
        pose: Any,
        holistic: Any,
        max_players: int = 4,
    ) -> List[Dict[str, Any]]:
        proposals = self._propose_regions(frame)
        detections: List[Dict[str, Any]] = []

        for proposal in proposals:
            detection = self._detect_on_region(frame, proposal, pose, holistic)
            if detection:
                detections.append(detection)

        if not detections:
            # Last fallback: pose directly on full frame.
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pose_result = pose.process(rgb)
            landmarks = pose_result.pose_landmarks.landmark if pose_result and pose_result.pose_landmarks else None
            if landmarks:
                info = extract_bbox_from_landmarks(
                    landmarks,
                    frame.shape[1],
                    frame.shape[0],
                    self.min_visibility,
                )
                if info:
                    bbox, conf = info
                    detections.append(
                        {
                            "bbox": bbox,
                            "confidence": float(np.clip(conf, 0.0, 1.0)),
                            "preview": extract_zoom_crop(frame, bbox),
                        }
                    )

        detections.sort(key=lambda item: item["confidence"], reverse=True)

        kept: List[Dict[str, Any]] = []
        for det in detections:
            if any(iou(det["bbox"], prev["bbox"]) > 0.55 for prev in kept):
                continue
            kept.append(det)
            if len(kept) >= max_players:
                break

        return kept

    def scan_video(
        self,
        video_path: str,
        sample_frames: int = 24,
        max_previews: int = 6,
        min_confidence: float = 0.35,
    ) -> Dict[str, Any]:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Unable to open video: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0:
            fps = 30.0

        if total_frames > 0:
            frame_indices = np.linspace(0, total_frames - 1, num=min(sample_frames, total_frames), dtype=int)
        else:
            frame_indices = np.arange(0, sample_frames, dtype=int)

        collected: List[Dict[str, Any]] = []
        pose_module, holistic_module, _ = get_mediapipe_solution_modules()

        with pose_module.Pose(
            static_image_mode=True,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=self.min_detection_confidence,
            min_tracking_confidence=0.5,
        ) as pose, holistic_module.Holistic(
            static_image_mode=True,
            model_complexity=1,
            min_detection_confidence=self.min_detection_confidence,
            min_tracking_confidence=0.5,
        ) as holistic:
            for frame_idx in frame_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
                ok, frame = cap.read()
                if not ok:
                    continue
                if not frame_is_clean(frame):
                    continue

                detections = self.detect_players_in_frame(frame, pose, holistic)
                for det in detections:
                    if det["confidence"] < min_confidence:
                        continue
                    det["frame_index"] = int(frame_idx)
                    det["timestamp_sec"] = round(frame_idx / fps, 2)
                    collected.append(det)

        cap.release()

        if not collected:
            raise NoPlayersDetectedError(
                "No players detected—try better lighting, steadier framing, or a closer camera angle."
            )

        collected.sort(key=lambda item: item["confidence"], reverse=True)
        curated: List[Dict[str, Any]] = []
        for det in collected:
            duplicate = False
            for prev in curated:
                if iou(det["bbox"], prev["bbox"]) > 0.7 and abs(det["frame_index"] - prev["frame_index"]) < int(fps * 2):
                    duplicate = True
                    break
            if duplicate:
                continue
            curated.append(det)
            if len(curated) >= max_previews:
                break

        players: List[Dict[str, Any]] = []
        for idx, det in enumerate(curated):
            x, y, w, h = det["bbox"]
            players.append(
                {
                    "index": idx,
                    "confidence": round(float(det["confidence"]), 3),
                    "frame_index": int(det["frame_index"]),
                    "timestamp_sec": float(det["timestamp_sec"]),
                    "bbox": [int(x), int(y), int(w), int(h)],
                    "base64_image": image_to_data_url(det["preview"]),
                }
            )

        return {
            "video_path": os.path.abspath(video_path),
            "players": players,
            "best_player_index": 0,
            "scanned_at": int(time.time()),
        }


def get_or_run_scan(video_path: str, force: bool = False) -> Dict[str, Any]:
    cache_key = video_cache_key(video_path)
    if not force:
        with scan_cache_lock:
            cached = scan_cache.get(cache_key)
            if cached:
                return cached

    detector = MediaPipePlayerDetector()
    result = detector.scan_video(video_path)
    with scan_cache_lock:
        scan_cache[cache_key] = result
    return result


def extract_clean_frames(
    video_path: str,
    max_frames: int = 12,
) -> List[Tuple[int, float, np.ndarray]]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    if fps <= 0:
        fps = 30.0

    if total_frames > 0:
        indices = np.linspace(0, total_frames - 1, num=min(max_frames * 2, total_frames), dtype=int)
    else:
        indices = np.arange(0, max_frames * 2, dtype=int)

    frames: List[Tuple[int, float, np.ndarray]] = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if not ok:
            continue
        if frame_is_clean(frame):
            frames.append((int(idx), round(idx / fps, 2), frame))
            if len(frames) >= max_frames:
                break

    if not frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
        if ok:
            frames.append((0, 0.0, frame))

    cap.release()
    return frames


def build_gemini_prompt(player: Dict[str, Any], frame_count: int) -> str:
    return (
        f"{GEMINI_PROMPT}\n\n"
        f"Selected player index: {player['index']}\n"
        f"Selected player confidence: {player['confidence']}\n"
        f"Selected player bbox [x,y,w,h]: {player['bbox']}\n"
        f"Total sampled frames provided: {frame_count}\n"
    )


def analyze_technique_with_gemini(
    sampled_frames: List[Tuple[int, float, np.ndarray]],
    player: Dict[str, Any],
) -> Dict[str, Any]:
    if genai is None:
        raise RuntimeError("google-generativeai is not installed. Install with: pip install google-generativeai")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in environment variables")

    genai.configure(api_key=api_key)
    model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    model = genai.GenerativeModel(model_name)

    if not sampled_frames:
        raise RuntimeError("No frames available for Gemini analysis")

    prompt = build_gemini_prompt(player, len(sampled_frames))
    parts: List[Any] = [prompt]

    for _, ts_sec, frame in sampled_frames[:8]:
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 86])
        if not ok:
            continue
        parts.append(f"Frame timestamp: {ts_sec} seconds")
        parts.append({"mime_type": "image/jpeg", "data": encoded.tobytes()})

    if len(parts) <= 1:
        raise RuntimeError("Failed to encode frames for Gemini request")

    response = model.generate_content(
        contents=parts,
        generation_config={
            "temperature": 0.2,
            "response_mime_type": "application/json",
        },
    )

    text = getattr(response, "text", "")
    if not text:
        raise RuntimeError("Gemini returned an empty response")

    return parse_json_response(text)


def draw_summary_overlay(
    frame: np.ndarray,
    summary: Dict[str, Any],
    player: Dict[str, Any],
    timestamp_sec: float,
) -> None:
    h, w = frame.shape[:2]
    header_h = 118
    cv2.rectangle(frame, (0, 0), (w, header_h), (12, 12, 12), -1)

    title = f"Sport: {summary['sport']}   Form Score: {summary['formScore']}/100"
    cv2.putText(frame, title, (14, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (90, 235, 255), 2, cv2.LINE_AA)

    tips = summary.get("tips", [])
    for i, tip in enumerate(tips[:3]):
        text = f"{i + 1}. {tip}"
        cv2.putText(
            frame,
            text[:110],
            (14, 54 + 22 * i),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (220, 220, 220),
            1,
            cv2.LINE_AA,
        )

    footer_h = 32
    cv2.rectangle(frame, (0, h - footer_h), (w, h), (0, 0, 0), -1)
    footer = (
        f"t={timestamp_sec:0.2f}s | selected player={player['index']} "
        f"conf={player['confidence']:.2f}"
    )
    cv2.putText(frame, footer, (12, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1, cv2.LINE_AA)


def render_annotated_video(
    video_path: str,
    output_path: str,
    summary: Dict[str, Any],
    player: Dict[str, Any],
    job_id: Optional[str] = None,
) -> None:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video for rendering: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS))
    if fps <= 0:
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Unable to initialize output video writer")

    pose_module, _, draw = get_mediapipe_solution_modules()
    pose_connections = pose_module.POSE_CONNECTIONS

    with pose_module.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        idx = 0
        last_landmarks = None

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            # Run pose every 2 frames for better throughput on large videos.
            if idx % 2 == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = pose.process(rgb)
                last_landmarks = result.pose_landmarks if result and result.pose_landmarks else None

            if last_landmarks:
                draw.draw_landmarks(
                    frame,
                    last_landmarks,
                    pose_connections,
                    landmark_drawing_spec=draw.DrawingSpec(color=(0, 230, 120), thickness=2, circle_radius=2),
                    connection_drawing_spec=draw.DrawingSpec(color=(0, 170, 255), thickness=2, circle_radius=1),
                )

            timestamp = idx / fps
            draw_summary_overlay(frame, summary, player, timestamp)
            writer.write(frame)
            idx += 1

            if job_id and frame_count > 0 and idx % 20 == 0:
                update_job(
                    job_id,
                    stage=5,
                    stage_label=stage_name(5),
                    progress=round(min(0.99, idx / frame_count), 4),
                    detail=f"Rendering frame {idx}/{frame_count}",
                )

    writer.release()
    cap.release()


def update_job(job_id: str, **fields: Any) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = time.time()


def create_job(video_path: str, player_index: Optional[int]) -> str:
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {
            "jobId": job_id,
            "stage": 0,
            "stage_label": stage_name(0),
            "complete": False,
            "progress": 0.0,
            "summary": None,
            "video_url": None,
            "output_path": None,
            "error": None,
            "detail": "Job created",
            "video_path": video_path,
            "requested_player_index": player_index,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
    return job_id


def run_analysis_job(job_id: str, video_path: str, player_index: Optional[int]) -> None:
    try:
        abs_video = os.path.abspath(video_path)
        if not os.path.exists(abs_video):
            raise FileNotFoundError(f"Video not found: {abs_video}")

        update_job(
            job_id,
            stage=1,
            stage_label=stage_name(1),
            progress=0.05,
            detail="Extracting clean representative frames",
        )
        sampled_frames = extract_clean_frames(abs_video, max_frames=12)
        if not sampled_frames:
            raise RuntimeError("Could not extract usable frames from video")

        update_job(
            job_id,
            stage=2,
            stage_label=stage_name(2),
            progress=0.22,
            detail="Detecting players with MediaPipe Pose/Holistic",
        )
        scan_result = get_or_run_scan(abs_video)
        players = scan_result["players"]
        if not players:
            raise NoPlayersDetectedError(
                "No players detected—try better lighting, steadier framing, or a closer camera angle."
            )

        if player_index is None:
            selected = players[scan_result.get("best_player_index", 0)]
        else:
            if player_index < 0 or player_index >= len(players):
                raise ValueError(f"player_index={player_index} out of range (0..{len(players)-1})")
            selected = players[player_index]

        update_job(
            job_id,
            stage=3,
            stage_label=stage_name(3),
            progress=0.45,
            detail="Calling Gemini for technique analysis",
        )
        raw_summary = analyze_technique_with_gemini(sampled_frames, selected)

        update_job(
            job_id,
            stage=4,
            stage_label=stage_name(4),
            progress=0.67,
            detail="Generating concise feedback summary",
        )
        summary = normalize_summary(raw_summary)
        update_job(job_id, summary=summary)

        output_path = str(OUTPUT_DIR / f"{job_id}_annotated.mp4")
        update_job(
            job_id,
            stage=5,
            stage_label=stage_name(5),
            progress=0.75,
            detail="Rendering annotated output video",
            output_path=output_path,
        )
        render_annotated_video(abs_video, output_path, summary, selected, job_id=job_id)

        update_job(
            job_id,
            stage=5,
            stage_label=stage_name(5),
            progress=1.0,
            complete=True,
            detail="Done",
            video_url=f"/video/{job_id}",
        )

    except Exception as exc:
        update_job(
            job_id,
            complete=True,
            error=str(exc),
            detail="Failed",
        )


async def save_upload_file(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "upload.mp4").suffix.lower() or ".mp4"
    out_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"

    with out_path.open("wb") as out_file:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            out_file.write(chunk)

    await upload.close()
    return str(out_path)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/scan")
async def scan(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing uploaded video file")

    video_path = await save_upload_file(file)

    try:
        result = get_or_run_scan(video_path, force=True)
    except NoPlayersDetectedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}") from exc

    if not result.get("players"):
        raise HTTPException(
            status_code=422,
            detail="No players detected—try better lighting, steadier framing, or a closer camera angle.",
        )

    return {
        "video_path": result["video_path"],
        "players": result["players"],
    }


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> Dict[str, Any]:
    abs_path = os.path.abspath(request.video_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail=f"Video path not found: {abs_path}")

    job_id = create_job(abs_path, request.player_index)

    thread = threading.Thread(
        target=run_analysis_job,
        args=(job_id, abs_path, request.player_index),
        daemon=True,
    )
    thread.start()

    return {"jobId": job_id}


@app.get("/status/{job_id}")
def status(job_id: str) -> Dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Unknown jobId: {job_id}")

        return {
            "stage": int(job["stage"]),
            "stage_label": job["stage_label"],
            "complete": bool(job["complete"]),
            "progress": float(job.get("progress", 0.0)),
            "summary": job.get("summary"),
            "video_url": job.get("video_url"),
            "error": job.get("error"),
            "detail": job.get("detail"),
        }


@app.get("/video/{job_id}")
def video(job_id: str) -> FileResponse:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Unknown jobId: {job_id}")
        output_path = job.get("output_path")

    if not output_path or not os.path.exists(output_path):
        raise HTTPException(status_code=404, detail="Rendered video not available yet")

    return FileResponse(output_path, media_type="video/mp4", filename=f"{job_id}.mp4")


def run_cli(video_path: str, player_index: Optional[int], autonomous: bool = True) -> None:
    abs_video = os.path.abspath(video_path)
    if not os.path.exists(abs_video):
        raise FileNotFoundError(f"Video not found: {abs_video}")

    print("[1/4] Extracting clean frames...")
    sampled_frames = extract_clean_frames(abs_video, max_frames=12)
    if not sampled_frames:
        raise RuntimeError("Could not extract usable frames from video")

    print("[2/4] Detecting players...")
    scan_result = get_or_run_scan(abs_video, force=True)
    players = scan_result["players"]
    if not players:
        raise NoPlayersDetectedError(
            "No players detected—try better lighting, steadier framing, or a closer camera angle."
        )

    if player_index is not None:
        if player_index < 0 or player_index >= len(players):
            raise ValueError(f"player_index={player_index} out of range (0..{len(players)-1})")
        selected = players[player_index]
        print(f"Using explicit player_index={player_index}")
    elif autonomous:
        selected = players[scan_result.get("best_player_index", 0)]
        print(
            f"Autonomous mode selected player {selected['index']} "
            f"(confidence={selected['confidence']:.3f})"
        )
    else:
        selected = players[0]

    print("[3/4] Running Gemini technique analysis...")
    raw_summary = analyze_technique_with_gemini(sampled_frames, selected)
    summary = normalize_summary(raw_summary)

    print("[4/4] Rendering annotated video...")
    output_path = OUTPUT_DIR / f"cli_{Path(abs_video).stem}_{int(time.time())}.mp4"
    render_annotated_video(abs_video, str(output_path), summary, selected, job_id=None)

    print("\nAnalysis complete")
    print(json.dumps(summary, indent=2))
    print(f"Output video: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sports Video Analysis MVP server + CLI")
    subparsers = parser.add_subparsers(dest="command")

    serve_parser = subparsers.add_parser("serve", help="Run FastAPI server")
    serve_parser.add_argument("--host", default="0.0.0.0")
    serve_parser.add_argument("--port", type=int, default=8000)

    cli_parser = subparsers.add_parser("cli", help="Run local autonomous analysis")
    cli_parser.add_argument("video_path", help="Path to local video file")
    cli_parser.add_argument("--player-index", type=int, default=None)
    cli_parser.add_argument("--no-autonomous", action="store_true")

    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    if args.command == "cli":
        run_cli(
            video_path=args.video_path,
            player_index=args.player_index,
            autonomous=not args.no_autonomous,
        )
    else:
        host = getattr(args, "host", "0.0.0.0")
        port = getattr(args, "port", 8000)
        uvicorn.run("app:app", host=host, port=port, reload=False)
