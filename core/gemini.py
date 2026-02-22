import json
import os
import sys
import time

try:
    import google.generativeai as genai
except ImportError:
    genai = None

from core.prompt    import get_system_prompt
from core.validator import validate_analysis


# ── Helpers ───────────────────────────────────────────────────────────────────

_MIME_TYPES = {
    '.mp4':  'video/mp4',
    '.mov':  'video/quicktime',
    '.avi':  'video/x-msvideo',
    '.mkv':  'video/x-matroska',
    '.webm': 'video/webm',
    '.m4v':  'video/mp4',
}


def _ensure_genai():
    """Configure the SDK or exit with a helpful message."""
    if genai is None:
        print('ERROR: google-generativeai package not installed.')
        print('  Run:  pip install google-generativeai')
        sys.exit(1)

    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print('ERROR: GEMINI_API_KEY environment variable is not set.')
        print('  Export it:  export GEMINI_API_KEY="your-key-here"')
        sys.exit(1)

    genai.configure(api_key=api_key)


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
) -> dict:
    """
    Upload *video_path* to Gemini, analyze it with the coaching prompt,
    and return the parsed JSON dict.

    Parameters
    ----------
    video_path : str
        Path to the video file (.mp4, .mov, etc.).
    model_name : str
        Gemini model identifier.
    strict : bool
        If True, raise on validation warnings; otherwise just print them.

    Returns
    -------
    dict
        The complete analysis JSON.
    """
    _ensure_genai()

    # ── 1. Upload video ───────────────────────────────────────────────────
    ext       = os.path.splitext(video_path)[1].lower()
    mime_type = _MIME_TYPES.get(ext, 'video/mp4')

    print(f'[Gemini] Uploading {video_path}  ({mime_type})')
    video_file = genai.upload_file(path=video_path, mime_type=mime_type)
    print(f'[Gemini] Upload complete — file: {video_file.name}')

    # ── 2. Wait for processing ────────────────────────────────────────────
    print('[Gemini] Waiting for video processing', end='', flush=True)
    while video_file.state.name == 'PROCESSING':
        time.sleep(5)
        print('.', end='', flush=True)
        video_file = genai.get_file(video_file.name)
    print(' done.')

    if video_file.state.name == 'FAILED':
        raise RuntimeError(
            f'Gemini video processing failed.  State: {video_file.state}'
        )

    # ── 3. Generate analysis ──────────────────────────────────────────────
    prompt = get_system_prompt()
    print(f'[Gemini] Analyzing with model: {model_name}')

    model    = genai.GenerativeModel(model_name)
    response = model.generate_content(
        [video_file, prompt],
        generation_config=genai.GenerationConfig(
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
        genai.delete_file(video_file.name)
        print('[Gemini] Remote video file cleaned up.')
    except Exception:
        pass  # best-effort

    print(f'[Gemini] Analysis complete — {len(result.get("shots", []))} events detected.')
    return result
