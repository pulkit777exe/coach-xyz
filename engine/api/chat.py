"""api/chat.py — Conversational follow-up on an analysis result (SSE + unary)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from api.errors import error_response
from core.chat_client import extract_timestamp_refs, generate_reply, is_configured, stream_chat_sse
from core.chat_prompt import get_chat_prompt
from core.gemini_client import GeminiServiceError
from core.jobs import JobNotFoundError, get_job

router = APIRouter()


async def _load_chat_context(request: Request) -> tuple[Any, str, list] | JSONResponse:
    """Shared request handling for /chat and /chat/stream.

    Returns (job, user_message, conversation_history), or the error response
    to return as-is when validation or job loading fails.
    """
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    job_id = payload.get("job_id")
    user_message = (payload.get("message") or "").strip()
    conversation_history = payload.get("conversation_history") or []

    if not job_id:
        return error_response(400, "INVALID_REQUEST", "job_id required")
    if not user_message:
        return error_response(400, "INVALID_REQUEST", "message required")

    # Load the job's analysis result
    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return error_response(404, "JOB_NOT_FOUND", "Job not found or expired")

    if not job.summary:
        return error_response(400, "INVALID_REQUEST", "Analysis not complete yet — no summary available")

    return job, user_message, conversation_history


@router.post("/chat")
async def chat(request: Request) -> JSONResponse:
    """Conversational follow-up on an analysis result.

    Accepts a job_id, user message, and optional conversation history.
    Returns an AI reply grounded in the original analysis data.

    The blocking Gemini call runs in a worker thread (see
    core.chat_client.generate_reply) so the event loop stays responsive.
    """
    context = await _load_chat_context(request)
    if isinstance(context, JSONResponse):
        return context
    job, user_message, conversation_history = context

    messages = get_chat_prompt(
        analysis_result=job.summary,
        conversation_history=conversation_history,
        user_message=user_message,
    )

    try:
        reply = await generate_reply(messages)
    except GeminiServiceError as exc:
        return error_response(exc.status_code, exc.code, exc.message)

    return JSONResponse(content={
        "reply": reply,
        "timestamp_refs": extract_timestamp_refs(reply),
        "event_refs": [],
    })


@router.post("/chat/stream")
async def chat_stream(request: Request):
    """Streaming version of /chat — returns Server-Sent Events.

    Each SSE event is one of:
      data: {"type":"token","text":"..."}   — incremental text chunk
      data: {"type":"done","text":"full reply","timestamp_refs":[...]}  — final
      data: {"type":"error","message":"..."}  — error
    """
    context = await _load_chat_context(request)
    if isinstance(context, JSONResponse):
        return context
    job, user_message, conversation_history = context

    messages = get_chat_prompt(
        analysis_result=job.summary,
        conversation_history=conversation_history,
        user_message=user_message,
    )

    if not is_configured():
        return error_response(500, "GEMINI_NOT_CONFIGURED", "AI service is not configured.")

    return StreamingResponse(
        stream_chat_sse(messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
