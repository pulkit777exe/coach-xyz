"""api/report.py — One-click AI report generation (driven by the server queue)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from api.errors import error_response
from core.gemini_client import GeminiServiceError
from core.report_client import generate_report
from core.report_prompt import get_report_prompt

router = APIRouter()


@router.post("/report")
async def report(request: Request) -> JSONResponse:
    """One-click AI report generation (called by the BullMQ worker).

    Grounded only in `report_context` (org data assembled server-side); returns
    a structured JSON report plus the raw Gemini text so the server can persist
    both and keep a source of truth for re-generation.
    """
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    report_context = payload.get("report_context")
    report_type = (payload.get("report_type") or "").strip()

    if not isinstance(report_context, dict) or not report_context:
        return error_response(400, "INVALID_REQUEST", "report_context (object) required")
    if not report_type:
        return error_response(400, "INVALID_REQUEST", "report_type required")

    messages = get_report_prompt(
        report_context=report_context,
        report_type=report_type,
        sport=payload.get("sport"),
        student_name=payload.get("student_name"),
    )

    try:
        report_data, raw_text = await generate_report(messages, report_context)
    except GeminiServiceError as exc:
        return error_response(exc.status_code, exc.code, exc.message)

    return JSONResponse(content={"report": report_data, "raw": raw_text})
