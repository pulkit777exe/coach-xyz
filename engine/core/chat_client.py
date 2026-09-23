"""
chat_client.py — Gemini invocation for /chat and /chat/stream.

Owns the model calls, deadline, quota/error mapping, reply parsing, and the
streaming pump so the routers stay transport-only. Uses the shared client
singleton from core.gemini_client — one client for analysis, chat, and
report. Prompt construction stays in core.chat_prompt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import AsyncIterator

from core.config import CHAT_GEMINI_TIMEOUT_S, GEMINI_MODEL
from core.gemini_client import (
    GeminiServiceError,
    genai_types,
    is_quota_error,
    shared_client,
)


def is_configured() -> bool:
    """Whether the shared Gemini client exists (else GEMINI_NOT_CONFIGURED)."""
    return shared_client() is not None


def extract_timestamp_refs(text: str) -> list[float]:
    """`<number>s` mentions in a reply (chat timestamp links), sorted unique."""
    return sorted(set(float(m) for m in re.findall(r'(\d+\.?\d*)s', text)))


def _generate(client, messages: list[dict[str, str]]):
    return client.models.generate_content(
        model=GEMINI_MODEL,
        contents=messages[0]["content"],
        config=genai_types.GenerateContentConfig(temperature=0.4),
    )


async def generate_reply(messages: list[dict[str, str]]) -> str:
    """One non-streaming chat round-trip.

    Runs the blocking Gemini call in a worker thread so the event loop stays
    responsive, with an overall deadline so a hung model call fails fast (the
    server gives /chat 60s — this deadline sits inside it).
    """
    client = shared_client()
    if client is None:
        raise GeminiServiceError(500, "GEMINI_NOT_CONFIGURED", "AI service is not configured.")

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(_generate, client, messages), timeout=CHAT_GEMINI_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        logging.error("Chat Gemini timeout")
        raise GeminiServiceError(504, "GEMINI_TIMEOUT", "AI service timed out. Please try again.")
    except Exception as exc:
        if is_quota_error(exc):
            raise GeminiServiceError(
                429, "GEMINI_QUOTA_EXCEEDED", "AI quota exceeded. Please try again later."
            ) from exc
        logging.error(f"Chat Gemini error: {exc}")
        raise GeminiServiceError(500, "GEMINI_ERROR", "AI service error. Please try again.") from exc

    return getattr(response, "text", None) or ""


def _stream_error_event(exc: BaseException) -> str:
    if is_quota_error(exc):
        return f"data: {json.dumps({'type': 'error', 'message': 'AI quota exceeded. Please try again later.'})}\n\n"
    logging.error(f"Chat stream Gemini error: {exc}")
    return f"data: {json.dumps({'type': 'error', 'message': 'AI service error. Please try again.'})}\n\n"


async def stream_chat_sse(messages: list[dict[str, str]]) -> AsyncIterator[str]:
    """SSE chunks for /chat/stream: `data: {…}` frames plus `: ping` comments.

    Async SSE generator — the blocking Gemini iterator runs in a worker
    thread and pushes chunks through a queue, so the event loop stays
    responsive and each chunk is flushed immediately (no buffering lag).
    A first-chunk deadline keeps a hung model call from hanging the SSE
    stream forever. Short waits double as SSE comment heartbeats (`: ping`
    lines are ignored by event parsers but keep proxies/CDNs from closing an
    idle stream); the overall deadline still bounds a hung model call.
    Each SSE event is one of:
      data: {"type":"token","text":"..."}   — incremental text chunk
      data: {"type":"done","text":"full reply","timestamp_refs":[...]}  — final
      data: {"type":"error","message":"..."}  — error
    """
    client = shared_client()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def _pump() -> None:
        try:
            stream = client.models.generate_content_stream(
                model=GEMINI_MODEL,
                contents=messages[0]["content"],
                config=genai_types.GenerateContentConfig(temperature=0.4),
            )
            for chunk in stream:
                text = getattr(chunk, "text", None) or ""
                if text:
                    loop.call_soon_threadsafe(queue.put_nowait, ("token", text))
            loop.call_soon_threadsafe(queue.put_nowait, ("end", None))
        except Exception as exc:  # noqa: BLE001 — forwarded to the SSE consumer
            loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

    pump_task = asyncio.create_task(asyncio.to_thread(_pump))
    full_text = ""
    started = loop.time()
    try:
        while True:
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                if loop.time() - started > CHAT_GEMINI_TIMEOUT_S:
                    logging.error("Chat stream Gemini timeout")
                    yield f"data: {json.dumps({'type': 'error', 'message': 'AI service timed out. Please try again.'})}\n\n"
                    return
                yield ": ping\n\n"
                continue
            if kind == "token":
                full_text += payload
                yield f"data: {json.dumps({'type': 'token', 'text': payload})}\n\n"
            elif kind == "end":
                break
            else:
                yield _stream_error_event(payload)
                return
    finally:
        if not pump_task.done():
            pump_task.cancel()

    timestamp_refs = extract_timestamp_refs(full_text)
    yield f"data: {json.dumps({'type': 'done', 'text': full_text, 'timestamp_refs': timestamp_refs, 'event_refs': []})}\n\n"
