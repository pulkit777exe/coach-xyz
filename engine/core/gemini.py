import json
import os
import sys
import time
import tempfile
import subprocess

import cv2

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_errors = None
    genai_types = None

from core.prompt import get_system_prompt
from core.validator import validate_analysis


# ── Helpers ───────────────────────────────────────────────────────────────────

_MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.m4v': 'video/mp4',
}


def _truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _maybe_prepare_analysis_proxy(video_path: str) -> tuple[str, str | None]:
    """
    Optionally transcode to a lighter analysis proxy to speed Gemini upload/processing.
    Disabled by default; enable with COACHAI_ANALYSIS_PROXY=1.
    """
    if not _truthy(os.environ.get("COACHAI_ANALYSIS_PROXY")):
        return video_path, None

    max_height = int(os.environ.get("COACHAI_ANALYSIS_MAX_HEIGHT", "720"))
    max_fps = float(os.environ.get("COACHAI_ANALYSIS_MAX_FPS", "24"))

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return video_path, None
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
    src_f = float(cap.get(cv2.CAP_PROP_FPS)) or 0.0
    cap.release()

    if src_h <= 0 or src_h <= max_height and src_f <= max_fps:
        return video_path, None

    fd, out_path = tempfile.mkstemp(prefix="coachai_proxy_", suffix=".mp4")
    os.close(fd)

    vf = f"scale=-2:min({max_height},ih),fps={max_fps}"
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        video_path,
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        out_path,
    ]
    try:
        subprocess.run(cmd, check=True)
        print(f"[Gemini] Using analysis proxy: {out_path}")
        return out_path, out_path
    except Exception as exc:
        print(f"[Gemini] Proxy transcode failed ({exc}); falling back to original.")
        try:
            os.remove(out_path)
        except Exception:
            pass
        return video_path, None


def _ensure_genai():
    """Configure the SDK or exit with a helpful message."""
    if genai is None:
        print('ERROR: google-genai package not installed.')
        print('  Run:  pip install google-genai')
        sys.exit(1)

    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print('ERROR: GEMINI_API_KEY environment variable is not set.')
        print('  Export it:  export GEMINI_API_KEY="your-key-here"')
        sys.exit(1)

    return genai.Client(api_key=api_key)


def _clean_json_text(raw: str) -> str:
    """Strip markdown fences or preamble that Gemini may add around JSON."""
    text = raw.strip()
    if text.startswith('```'):
        lines = text.split('\n')
        # Remove opening fence (```json or ```)
        lines = lines[1:]
        # Remove closing fence if present
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        text = '\n'.join(lines)
    return text


def _clean_analysis(result: dict) -> None:
    """
    Remove inapplicable (N/A) entries from every shot's form_breakdown in-place.
    This keeps the saved JSON lean regardless of whether Gemini follows the prompt
    instruction to omit those keys.
    """
    _NA_VALUES = {'N/A', 'n/a', 'na', 'NA', '', 'null', None}
    for shot in result.get('shots', []):
        bd = shot.get('form_breakdown')
        if isinstance(bd, dict):
            shot['form_breakdown'] = {
                k: v for k, v in bd.items() if v not in _NA_VALUES
            }


# ── Public API ────────────────────────────────────────────────────────────────


def analyze_video(
    video_path: str,
    model_name: str = 'gemini-2.5-flash',
    strict: bool = False,
    player_focus: dict | None = None,
    chunk_info: dict | None = None,
) -> dict:
    """
    Upload *video_path* to Gemini, analyze it with the coaching prompt,
    and return the parsed JSON dict.

    Parameters
    ----------
    video_path   : path to the video file.
    model_name   : Gemini model identifier.
    strict       : raise on validation warnings if True.
    player_focus : dict with 'id' and 'position' — focus on one player.
    chunk_info   : dict with chunk metadata for long-video segmented analysis.

    Returns
    -------
    dict — the complete analysis JSON.
    """
    client = _ensure_genai()

    proxy_path, cleanup_path = _maybe_prepare_analysis_proxy(video_path)

    # ── 1. Upload video ───────────────────────────────────────────────────
    ext = os.path.splitext(proxy_path)[1].lower()
    mime_type = _MIME_TYPES.get(ext, 'video/mp4')

    print(f'[Gemini] Uploading {proxy_path}  ({mime_type})')
    video_file = client.files.upload(file=proxy_path, config={'mime_type': mime_type})
    print(f'[Gemini] Upload complete — file: {video_file.name}')

    # ── 2. Wait for processing ────────────────────────────────────────────
    print('[Gemini] Waiting for video processing', end='', flush=True)
    while video_file.state.name == 'PROCESSING':
        time.sleep(5)
        print('.', end='', flush=True)
        video_file = client.files.get(name=video_file.name)
    print(' done.')

    if video_file.state.name == 'FAILED':
        raise RuntimeError(
            f'Gemini video processing failed.  State: {video_file.state}'
        )

    # ── 3. Generate analysis ──────────────────────────────────────────────
    prompt = get_system_prompt(
        player_focus=player_focus,
        chunk_info=chunk_info,
    )
    print(f'[Gemini] Analyzing with model: {model_name}')

    response = client.models.generate_content(
        model=model_name,
        contents=[video_file, prompt],
        config=genai_types.GenerateContentConfig(
            response_mime_type='application/json',
            temperature=0.1,
        ),
    )

    # ── 4. Parse JSON ─────────────────────────────────────────────────────
    raw_text = _clean_json_text(response.text)
    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        print(f'[Gemini] ERROR: Could not parse JSON response.\n{exc}')
        print('[Gemini] Raw response:\n', raw_text[:2000])
        raise

    # ── 4b. Strip N/A noise from form_breakdown ───────────────────────────
    _clean_analysis(result)

    # ── 5. Validate ───────────────────────────────────────────────────────
    warnings = validate_analysis(result)
    if warnings:
        header = '[Gemini] Validation warnings:'
        print(header)
        for w in warnings:
            print(f'  ⚠  {w}')
        if strict:
            raise ValueError(f'{len(warnings)} validation error(s) — see above.')

    # ── 6. Clean up remote file ───────────────────────────────────────────
    try:
        client.files.delete(name=video_file.name)
        print('[Gemini] Remote video file cleaned up.')
    except Exception:
        pass  # best-effort

    if cleanup_path:
        try:
            os.remove(cleanup_path)
        except Exception:
            pass

    print(f'[Gemini] Analysis complete — {len(result.get("shots", []))} events detected.')
    return result
