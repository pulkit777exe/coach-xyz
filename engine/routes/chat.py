import asyncio
import json
import re
from datetime import date
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core import events, jobs, llm, pipeline, prompts
from core.errors import invalid

router = APIRouter()
SECONDS = re.compile(r"(\d+\.?\d*)s\b")
EVENT_IDS = re.compile(r"\[([^\]\s]+:e\d+)\]")


class Report(BaseModel):
    narrative: str
    summary: str
    strengths: list[str]
    areas_to_improve: list[str]
    recommendations: list[str]
    form_score_trend: Literal["improving", "steady", "declining", "mixed"]
    highlight_max: list[str]
    generated_at: str


def _unavailable(exc: llm.Unavailable) -> JSONResponse:
    return JSONResponse(exc.to_dict() | {"retry_after": exc.retry_after}, status_code=503,
                        headers={"Retry-After": str(int(exc.retry_after))})


def _refs(text: str) -> dict:
    return {"timestamp_refs": sorted({float(m) for m in SECONDS.findall(text)}),
            "event_refs": sorted(set(EVENT_IDS.findall(text)))}


async def _chat_input(request: Request) -> tuple[dict, str, list[dict]]:
    body = await request.json()
    job_id, message = body.get("job_id"), (body.get("message") or "").strip()
    if not job_id or not message:
        raise invalid("job_id and message required")
    return jobs.load_result(job_id), message, body.get("conversation_history") or []


@router.post("/chat")
async def chat(request: Request):
    result, message, history = await _chat_input(request)
    try:
        model = pipeline.make_model()
        reply = await asyncio.to_thread(model.text, prompts.chat_prompt(history, message), prompts.chat_system(result))
    except llm.Unavailable as exc:
        return _unavailable(exc)
    return {"reply": reply, **_refs(reply)}


@router.post("/chat/stream")
async def chat_stream(request: Request):
    result, message, history = await _chat_input(request)
    try:
        model = pipeline.make_model()
    except llm.Unavailable as exc:
        return _unavailable(exc)
    prompt, system = prompts.chat_prompt(history, message), prompts.chat_system(result)

    async def sse():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def pump():
            try:
                for piece in model.stream(prompt, system):
                    loop.call_soon_threadsafe(queue.put_nowait, ("token", piece))
                loop.call_soon_threadsafe(queue.put_nowait, ("end", None))
            except Exception as exc:
                loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

        task = asyncio.create_task(asyncio.to_thread(pump))
        text = ""
        try:
            while True:
                try:
                    kind, item = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if kind == "token":
                    text += item
                    yield f"data: {json.dumps({'type': 'token', 'text': item})}\n\n"
                elif kind == "end":
                    yield f"data: {json.dumps({'type': 'done', 'text': text, **_refs(text)})}\n\n"
                    return
                else:
                    msg = item.message if hasattr(item, "message") else "AI service error. Please try again."
                    yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
                    return
        finally:
            task.cancel()

    return events.sse_stream(sse())


@router.post("/report")
async def report(request: Request):
    body = await request.json()
    context, kind = body.get("report_context"), (body.get("report_type") or "").strip()
    if not isinstance(context, dict) or not context or not kind:
        raise invalid("report_context (object) and report_type required")
    prompt = prompts.report_prompt(context, kind, body.get("sport"), body.get("student_name"))
    try:
        model = pipeline.make_model()
        _, parsed = await asyncio.to_thread(model.structured, prompt, Report)
    except llm.Unavailable as exc:
        return _unavailable(exc)
    parsed.highlight_max = parsed.highlight_max[:3]
    parsed.generated_at = parsed.generated_at or date.today().isoformat()
    return {"report": parsed.model_dump(), "raw": parsed.model_dump_json()}
