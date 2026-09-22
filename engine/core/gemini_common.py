"""Shared Gemini utilities used by both gemini.py and gemini_client.py."""

import json
import re
from typing import Any

MIME_TYPES: dict[str, str] = {
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
}


def clean_json_text(text: str) -> str:
    """Strip markdown fences and leading/trailing whitespace from JSON text."""
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*$", "", text)
    return text.strip()


def parse_json_response(text: str) -> dict[str, Any]:
    """Parse a JSON response from Gemini, handling markdown fences."""
    cleaned = clean_json_text(text)
    return json.loads(cleaned)
