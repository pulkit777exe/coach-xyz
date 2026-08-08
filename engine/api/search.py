from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from core.errors import EngineError, GeminiParseError

router = APIRouter()

try:
    from core.deep_search import DeepSearchEngine, DeepSearchResponse
except ImportError:
    DeepSearchEngine = None
    DeepSearchResponse = None


def _serialize_response(result: "DeepSearchResponse") -> dict:
    return {
        "query": result.query,
        "report": result.report,
        "sources": [
            {
                "url": s.url,
                "title": s.title,
                "snippet": s.snippet,
                "relevance": s.relevance,
            }
            for s in result.sources
        ],
        "angles_covered": result.angles_covered,
        "searches_performed": result.searches_performed,
        "depth_reached": result.depth_reached,
        "total_time_seconds": result.total_time_seconds,
        "metadata": result.metadata,
    }


@router.post("/search")
async def deep_search(request: Request) -> JSONResponse:
    """Execute a deep research query and return full results."""
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return JSONResponse(
            status_code=415,
            content={
                "code": "INVALID_REQUEST",
                "message": "JSON required",
                "layer": "engine",
                "retryable": False,
            },
        )

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={
                "code": "INVALID_REQUEST",
                "message": "Invalid JSON body",
                "layer": "engine",
                "retryable": False,
            },
        )

    query = (payload.get("query") or "").strip()
    if not query:
        return JSONResponse(
            status_code=400,
            content={
                "code": "INVALID_REQUEST",
                "message": "query is required",
                "layer": "engine",
                "retryable": False,
            },
        )

    if DeepSearchEngine is None:
        return JSONResponse(
            status_code=500,
            content={
                "code": "SEARCH_NOT_AVAILABLE",
                "message": "Deep search engine not available",
                "layer": "engine",
                "retryable": False,
            },
        )

    max_angles = min(int(payload.get("max_angles", 6)), 10)
    max_gap_searches = min(int(payload.get("max_gap_searches", 4)), 8)

    try:
        engine = DeepSearchEngine(
            max_angles=max_angles,
            max_gap_searches=max_gap_searches,
        )
        result = await engine.search(query)
        return JSONResponse(content=_serialize_response(result))
    except EngineError as exc:
        return JSONResponse(status_code=500, content=exc.to_dict())
    except Exception as exc:
        status_code = getattr(exc, "status_code", None)
        if status_code == 429:
            return JSONResponse(
                status_code=429,
                content={
                    "code": "GEMINI_QUOTA_EXCEEDED",
                    "message": "AI quota exceeded. Try again later.",
                    "layer": "engine",
                    "retryable": True,
                },
            )
        logging.error(f"[Search] Error: {exc}")
        return JSONResponse(
            status_code=500,
            content={
                "code": "SEARCH_FAILED",
                "message": "Deep search failed. Try again.",
                "layer": "engine",
                "retryable": True,
            },
        )


@router.post("/search/stream")
async def deep_search_stream(request: Request):
    """Execute deep search with SSE progress streaming."""
    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("application/json"):
        return JSONResponse(
            status_code=415,
            content={
                "code": "INVALID_REQUEST",
                "message": "JSON required",
                "layer": "engine",
                "retryable": False,
            },
        )

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={
                "code": "INVALID_REQUEST",
                "message": "Invalid JSON body",
                "layer": "engine",
                "retryable": False,
            },
        )

    query = (payload.get("query") or "").strip()
    if not query:
        return JSONResponse(
            status_code=400,
            content={
                "code": "INVALID_REQUEST",
                "message": "query is required",
                "layer": "engine",
                "retryable": False,
            },
        )

    max_angles = min(int(payload.get("max_angles", 6)), 10)
    max_gap_searches = min(int(payload.get("max_gap_searches", 4)), 8)

    async def generate():
        try:
            engine = DeepSearchEngine(
                max_angles=max_angles,
                max_gap_searches=max_gap_searches,
            )

            yield f"data: {json.dumps({'type': 'status', 'message': 'Decomposing query...'})}\n\n"

            from core.deep_search import DECOMPOSITION_SYSTEM_PROMPT
            decomposition = await engine._decompose_query(query)

            yield f"data: {json.dumps({
                'type': 'decomposition',
                'intent': decomposition.get('understood_intent', ''),
                'angles': [a['angle'] for a in decomposition.get('angles', [])],
                'entities': decomposition.get('key_entities', []),
            })}\n\n"

            angles = decomposition.get("angles", [])[:max_angles]
            angle_results = []

            for i, angle in enumerate(angles):
                yield f"data: {json.dumps({
                    'type': 'searching',
                    'current': i + 1,
                    'total': len(angles),
                    'angle': angle['angle'],
                })}\n\n"

                result = await engine._search_angle(angle["angle"], angle["search_query"])
                angle_results.append(result)

                yield f"data: {json.dumps({
                    'type': 'angle_complete',
                    'angle': angle['angle'],
                    'sources_found': len(result.sources),
                    'current': i + 1,
                    'total': len(angles),
                })}\n\n"

            yield f"data: {json.dumps({'type': 'status', 'message': 'Analyzing gaps...'})}\n\n"

            all_findings = "\n\n".join(
                f"## {r.angle}\n{r.findings}" for r in angle_results
            )
            gaps = await engine._analyze_gaps(query, all_findings)

            gap_results = []
            if not gaps.get("sufficient") and gaps.get("gaps"):
                gap_queries = gaps["gaps"][:max_gap_searches]
                yield f"data: {json.dumps({
                    'type': 'status',
                    'message': f'Deep diving into {len(gap_queries)} gaps...',
                })}\n\n"

                for i, gap in enumerate(gap_queries):
                    result = await engine._search_angle(gap["question"], gap["search_query"])
                    gap_results.append(result)

                    yield f"data: {json.dumps({
                        'type': 'gap_filled',
                        'question': gap['question'],
                        'current': i + 1,
                        'total': len(gap_queries),
                    })}\n\n"

            yield f"data: {json.dumps({'type': 'status', 'message': 'Generating report...'})}\n\n"

            report, all_sources = await engine._generate_report(
                query, decomposition, angle_results, gap_results
            )

            import time
            response = DeepSearchResponse(
                query=query,
                report=report,
                sources=all_sources,
                angles_covered=[r.angle for r in angle_results + gap_results],
                searches_performed=len(angle_results) + len(gap_results),
                depth_reached=2 if gap_results else 1,
                total_time_seconds=0,
                metadata={
                    "understood_intent": decomposition.get("understood_intent", ""),
                    "key_entities": decomposition.get("key_entities", []),
                    "coverage_score": gaps.get("coverage_score", 0),
                },
            )

            yield f"data: {json.dumps({
                'type': 'done',
                'result': _serialize_response(response),
            })}\n\n"

        except Exception as exc:
            status_code = getattr(exc, "status_code", None)
            if status_code == 429:
                yield f"data: {json.dumps({'type': 'error', 'message': 'AI quota exceeded. Try again later.'})}\n\n"
            else:
                logging.error(f"[Search] Stream error: {exc}")
                yield f"data: {json.dumps({'type': 'error', 'message': 'Search failed. Try again.'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
