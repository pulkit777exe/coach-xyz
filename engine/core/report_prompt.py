"""Prompt construction for one-click AI report generation.

Mirrors the `chat_prompt` voice conventions: a single user message whose
content is fully grounded in the supplied `report_context` (org data assembled
server-side by `buildReportContent`). The model replies with a single JSON
object that matches `REPORT_JSON_SCHEMA`.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from core.prompt_guard import wrap_org_data

REPORT_TYPES: List[str] = ["progress", "attendance", "performance", "monthly"]

REPORT_TYPE_DESCRIPTIONS: Dict[str, str] = {
    "progress": (
        "a progress report covering the student's overall development, technique "
        "evolution, and growth across the period."
    ),
    "attendance": (
        "an attendance-focused report linking session attendance to engagement and "
        "performance trends over the period."
    ),
    "performance": (
        "a performance report reviewing recent scores, form trajectory, and "
        "strengths/weaknesses discovered during the period."
    ),
    "monthly": (
        "a monthly summary that condenses attendance, performance, and highlights "
        "into a coach-ready digest."
    ),
}

REPORT_JSON_SCHEMA: Dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "narrative": {"type": "STRING"},
        "summary": {"type": "STRING"},
        "strengths": {"type": "ARRAY", "items": {"type": "STRING"}},
        "areas_to_improve": {"type": "ARRAY", "items": {"type": "STRING"}},
        "recommendations": {"type": "ARRAY", "items": {"type": "STRING"}},
        "form_score_trend": {"type": "STRING"},
        "highlight_max": {"type": "ARRAY", "items": {"type": "STRING"}},
        "generated_at": {"type": "STRING"},
    },
    "required": [
        "narrative",
        "summary",
        "strengths",
        "areas_to_improve",
        "recommendations",
        "form_score_trend",
        "highlight_max",
        "generated_at",
    ],
}

REPORT_RULES: List[str] = [
    "Use ONLY facts present in REPORT_CONTEXT. Never invent scores, attendance numbers, dates, or events.",
    "If a metric is missing from the context (for example no attendance data), acknowledge it briefly or omit it — never fabricate a value.",
    "strengths, areas_to_improve, and recommendations: one sentence per item, specific to this student.",
    "highlight_max: at most three short bullets, roughly 12 words each.",
    "form_score_trend: exactly one of the values `improving`, `steady`, `declining`, or `mixed`, based only on the scores in the context.",
    "narrative: 2-3 paragraphs in plain, coach-like, encouraging language. No generic fluff.",
    "generated_at: the current date as ISO (YYYY-MM-DD).",
    "Output ONLY a single JSON object matching REPORT_JSON_SCHEMA. No markdown fences, no extra text.",
]


def _render_context(report_context: Dict[str, Any]) -> str:
    """Render the org context into a compact JSON block for the prompt.

    Falls back to string conversion so datetimes and nested objects never
    crash serialization.
    """
    return json.dumps(report_context, indent=2, ensure_ascii=False, default=str)


def get_report_prompt(
    report_context: Dict[str, Any],
    report_type: str,
    sport: Optional[str] = None,
    student_name: Optional[str] = None,
) -> List[Dict[str, str]]:
    """Build the single user message for the /report endpoint.

    `report_type` selects the framing; the context is embedded verbatim so the
    model stays grounded. Returns a one-message list mirroring chat_prompt.
    """
    description = REPORT_TYPE_DESCRIPTIONS.get(report_type) or REPORT_TYPE_DESCRIPTIONS["progress"]

    identity_lines: List[str] = []
    if student_name:
        identity_lines.append(f"Student: {student_name}")
    if sport:
        identity_lines.append(f"Sport: {sport}")
    identity_block = (
        wrap_org_data("\n".join(identity_lines)) + "\n" if identity_lines else ""
    )

    rules_block = "\n".join(f"  {i + 1}. {rule}" for i, rule in enumerate(REPORT_RULES))

    content = f"""You are CoachXYZ, an expert multi-sport coach and analyst. \
Write {description}

{identity_block}REPORT_TYPE: {report_type}

REPORT_CONTEXT (JSON, may contain org/student/period/attendance/performance/analyses data):
{wrap_org_data(_render_context(report_context))}

GUIDELINES:
{rules_block}

Remember: ground every claim in REPORT_CONTEXT above. \
Return exactly one JSON object with these fields: narrative (string), summary (string), \
strengths (string[]), areas_to_improve (string[]), recommendations (string[]), \
form_score_trend (string), highlight_max (string[]), generated_at (string ISO date)."""

    return [{"role": "user", "content": content}]
