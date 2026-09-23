"""
report_client.py — Gemini invocation for /report.

Owns the structured-JSON config, response parsing, report normalization, and
quota/error mapping so the router stays transport-only. Uses the shared
client singleton from core.gemini_client — one client for analysis, chat,
and report. Prompt construction stays in core.report_prompt.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from core.config import GEMINI_MODEL
from core.gemini_common import parse_json_response
from core.gemini_client import (
    GeminiServiceError,
    genai_types,
    is_quota_error,
    shared_client,
)
from core.report_prompt import REPORT_JSON_SCHEMA


def report_config() -> Any:
    """GenerateContentConfig for structured JSON report output.

    Builds a genai Schema from the plain REPORT_JSON_SCHEMA dict when the
    google-genai package is available; otherwise falls back to a plain dict
    (only reachable in environments where the client is also unavailable).
    """
    if genai_types is None:
        return {
            "temperature": 0.4,
            "responseMimeType": "application/json",
            "responseSchema": REPORT_JSON_SCHEMA,
        }

    def _to_schema(node: Dict[str, Any]) -> Any:
        kwargs: Dict[str, Any] = {}
        for key, value in node.items():
            if key == "type":
                kwargs["type"] = genai_types.Type(str(value))
            elif key == "properties":
                kwargs["properties"] = {k: _to_schema(v) for k, v in value.items()}
            elif key == "items":
                kwargs["items"] = _to_schema(value)
            else:
                kwargs[key] = value
        return genai_types.Schema(**kwargs)

    return genai_types.GenerateContentConfig(
        temperature=0.4,
        response_mime_type="application/json",
        response_schema=_to_schema(REPORT_JSON_SCHEMA),
    )


def normalize_report(parsed: Dict[str, Any], report_context: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce the parsed report to its contract, best-effort.

    Guarantees each schema field exists with the right shape so the server can
    persist the report without re-validating.
    """
    def _string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    def _text(v: Any) -> str:
        return v if isinstance(v, str) else ""
    trend = _text(parsed.get("form_score_trend")).lower()
    if trend not in ("improving", "steady", "declining", "mixed"):
        trend = "steady"
    generated_at = (
        _text(parsed.get("generated_at"))
        or (report_context.get("generated_at") if isinstance(report_context.get("generated_at"), str) else "")
        or datetime.now(timezone.utc).isoformat()
    )
    return {
        "narrative": _text(parsed.get("narrative")),
        "summary": _text(parsed.get("summary")),
        "strengths": _string_list(parsed.get("strengths")),
        "areas_to_improve": _string_list(parsed.get("areas_to_improve")),
        "recommendations": _string_list(parsed.get("recommendations")),
        "form_score_trend": trend,
        "highlight_max": _string_list(parsed.get("highlight_max"))[:3],
        "generated_at": generated_at,
    }


async def generate_report(
    messages: list[dict[str, str]],
    report_context: Dict[str, Any],
) -> tuple[Dict[str, Any], str]:
    """Call Gemini for a structured report; returns (normalized report, raw text).

    Raises GeminiServiceError carrying the HTTP mapping /report has always
    used. No overall deadline here — this call never had one.
    """
    client = shared_client()
    if client is None:
        raise GeminiServiceError(500, "GEMINI_NOT_CONFIGURED", "AI service is not configured.")

    # Call Gemini in a thread to avoid blocking the event loop
    try:
        def _call_gemini():
            return client.models.generate_content(
                model=GEMINI_MODEL,
                contents=messages[0]["content"],
                config=report_config(),
            )

        response = await asyncio.to_thread(_call_gemini)
        raw_text = getattr(response, "text", None) or ""
    except Exception as exc:
        if is_quota_error(exc):
            raise GeminiServiceError(
                429, "GEMINI_QUOTA_EXCEEDED", "AI quota exceeded. Please try again later."
            ) from exc
        logging.error(f"Report Gemini error: {exc}")
        raise GeminiServiceError(500, "GEMINI_ERROR", "AI service error. Please try again.") from exc

    if not raw_text:
        raise GeminiServiceError(500, "GEMINI_EMPTY_RESPONSE", "AI returned an empty response. Please try again.")

    try:
        parsed = parse_json_response(raw_text)
    except Exception as exc:
        logging.error(f"Report parse failed: {exc}")
        raise GeminiServiceError(
            500, "GEMINI_PARSE_FAILED", "AI returned an unexpected response. Please try again."
        ) from exc

    if not isinstance(parsed, dict):
        raise GeminiServiceError(500, "GEMINI_PARSE_FAILED", "AI returned an unexpected response. Please try again.")

    return normalize_report(parsed, report_context), raw_text
