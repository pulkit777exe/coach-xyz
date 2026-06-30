from __future__ import annotations

import json
from typing import Any

from core.errors import GeminiParseError
from core.validator import validate_analysis


MAX_RETRIES = 3


def validate_gemini_output(raw_response: str, retry_count: int = 0) -> dict[str, Any]:
    """
    Parse and validate Gemini output with retry feedback.

    This is the L2 verification loop for AI output:
    1. Parse JSON
    2. Validate structure
    3. If invalid, provide feedback for retry
    """
    # Strip markdown fences if present
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:-1])

    # Parse JSON
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        if retry_count < MAX_RETRIES:
            raise GeminiParseError(
                f"Invalid JSON (attempt {retry_count + 1}/{MAX_RETRIES}): {e}"
            )
        raise GeminiParseError(f"Invalid JSON after {MAX_RETRIES} retries: {e}")

    # Validate structure
    errors = validate_analysis(parsed)
    if errors:
        if retry_count < MAX_RETRIES:
            raise GeminiParseError(
                f"Validation errors (attempt {retry_count + 1}/{MAX_RETRIES}): "
                + "; ".join(errors[:3])  # First 3 errors
            )
        raise GeminiParseError(
            f"Validation errors after {MAX_RETRIES} retries: " + "; ".join(errors[:5])
        )

    return parsed


def build_retry_feedback(errors: list[str]) -> str:
    """Build feedback string for Gemini retry."""
    return (
        "\n\nIMPORTANT: Your previous response was invalid. Errors:\n"
        + "\n".join(f"- {e}" for e in errors[:3])
        + "\nPlease ensure your response is valid JSON matching the schema."
    )
