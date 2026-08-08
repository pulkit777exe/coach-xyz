from __future__ import annotations

import asyncio
import json
import logging
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from core.chat_prompt import get_chat_prompt
from core.config import GEMINI_MODEL
from core.jobs import get_job
from core.errors import JobNotFoundError

from .sessions import _error_response

router = APIRouter()

import os as _os
try:
    from google import genai
    from google.genai import types as genai_types
    _gemini_client = genai.Client(api_key=_os.getenv("GEMINI_API_KEY")) if _os.getenv("GEMINI_API_KEY") else None
except ImportError:
    genai = None
    genai_types = None
    _gemini_client = None


@router.post("/chat")
async def chat(request: Request) -> JSONResponse:
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return _error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return _error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    job_id = payload.get("job_id")
    user_message = (payload.get("message") or "").strip()
    conversation_history = payload.get("conversation_history") or []

    if not job_id:
        return _error_response(400, "INVALID_REQUEST", "job_id required")
    if not user_message:
        return _error_response(400, "INVALID_REQUEST", "message required")

    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return _error_response(404, "JOB_NOT_FOUND", "Job not found or expired")

    if not job.summary:
        return _error_response(400, "INVALID_REQUEST", "Analysis not complete yet — no summary available")

    messages = get_chat_prompt(
        analysis_result=job.summary,
        conversation_history=conversation_history,
        user_message=user_message,
    )

    try:
        if _gemini_client is None:
            return _error_response(500, "GEMINI_NOT_CONFIGURED", "AI service is not configured.")

        def _call_gemini():
            return _gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=messages[0]["content"],
                config=genai_types.GenerateContentConfig(temperature=0.4),
            )

        response = await asyncio.to_thread(_call_gemini)
        reply = getattr(response, "text", None) or ""
    except Exception as exc:
        status_code = getattr(exc, "status_code", None)
        message = str(exc)
        is_quota = (
            status_code == 429
            or "RESOURCE_EXHAUSTED" in message
            or "quota" in message.lower()
        )
        if is_quota:
            return _error_response(429, "GEMINI_QUOTA_EXCEEDED", "AI quota exceeded. Please try again later.")
        logging.error(f"Chat Gemini error: {exc}")
        return _error_response(500, "GEMINI_ERROR", "AI service error. Please try again.")

    timestamp_refs = [float(m) for m in re.findall(r'(\d+\.?\d*)s', reply)]

    return JSONResponse(content={
        "reply": reply,
        "timestamp_refs": sorted(set(timestamp_refs)),
        "event_refs": [],
    })


@router.post("/chat/stream")
async def chat_stream(request: Request):
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return _error_response(415, "INVALID_REQUEST", "JSON required")

    try:
        payload = await request.json()
    except Exception:
        return _error_response(400, "INVALID_REQUEST", "Invalid JSON body")

    job_id = payload.get("job_id")
    user_message = (payload.get("message") or "").strip()
    conversation_history = payload.get("conversation_history") or []

    if not job_id:
        return _error_response(400, "INVALID_REQUEST", "job_id required")
    if not user_message:
        return _error_response(400, "INVALID_REQUEST", "message required")

    try:
        job = get_job(job_id)
    except JobNotFoundError:
        return _error_response(404, "JOB_NOT_FOUND", "Job not found or expired")

    if not job.summary:
        return _error_response(400, "INVALID_REQUEST", "Analysis not complete yet — no summary available")

    messages = get_chat_prompt(
        analysis_result=job.summary,
        conversation_history=conversation_history,
        user_message=user_message,
    )

    if _gemini_client is None:
        return _error_response(500, "GEMINI_NOT_CONFIGURED", "AI service is not configured.")

    def generate():
        full_text = ""
        try:
            for chunk in _gemini_client.models.generate_content_stream(
                model=GEMINI_MODEL,
                contents=messages[0]["content"],
                config=genai_types.GenerateContentConfig(temperature=0.4),
            ):
                text = getattr(chunk, "text", None) or ""
                if text:
                    full_text += text
                    yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        except Exception as exc:
            status_code = getattr(exc, "status_code", None)
            msg = str(exc)
            is_quota = (
                status_code == 429
                or "RESOURCE_EXHAUSTED" in msg
                or "quota" in msg.lower()
            )
            if is_quota:
                yield f"data: {json.dumps({'type': 'error', 'message': 'AI quota exceeded. Please try again later.'})}\n\n"
            else:
                logging.error(f"Chat stream Gemini error: {exc}")
                yield f"data: {json.dumps({'type': 'error', 'message': 'AI service error. Please try again.'})}\n\n"
            return

        timestamp_refs = sorted(set(float(m) for m in re.findall(r'(\d+\.?\d*)s', full_text)))
        yield f"data: {json.dumps({'type': 'done', 'text': full_text, 'timestamp_refs': timestamp_refs, 'event_refs': []})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
