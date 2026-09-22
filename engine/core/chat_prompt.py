"""
chat_prompt.py — Prompt template for conversational follow-up on analysis results.

The chat prompt gives Gemini the original analysis context and conversation history,
then answers the user's question grounded in the data.
"""

from __future__ import annotations

import json
from typing import Any

from core.prompt_guard import GUARD_RULE, USER_CLOSE, USER_OPEN, wrap_untrusted


def get_chat_prompt(
    analysis_result: dict[str, Any],
    conversation_history: list[dict[str, str]],
    user_message: str,
) -> list[dict[str, str]]:
    """
    Build a Gemini chat prompt with analysis context + conversation history.

    Structure: trusted analysis context and assistant history stay plain;
    every athlete-written turn is wrapped in UNTRUSTED delimiters so injected
    instructions inside questions or quoted history are treated as data.

    Returns a list of message dicts suitable for a multi-turn conversation.
    """
    system = _build_system_message(analysis_result)
    history = _format_history(conversation_history)
    question = wrap_untrusted(user_message, label="Athlete's question")

    messages: list[dict[str, str]] = [
        {"role": "user", "content": f"{system}\n\n{history}\n\n{question}"},
    ]

    return messages


def _build_system_message(analysis_result: dict[str, Any]) -> str:
    """Embed the full analysis result as context."""
    summary = analysis_result.get("summary", "No summary available.")
    sport = analysis_result.get("sport", "unknown")
    form_score = analysis_result.get("form_score", "N/A")
    overall_rating = analysis_result.get("overall_rating", "N/A")
    top_tips = analysis_result.get("top_tips", [])
    strengths = analysis_result.get("strengths", [])
    priority_drill = analysis_result.get("priority_drill", "")
    shot_events = analysis_result.get("shot_events", [])

    events_text = ""
    for i, evt in enumerate(shot_events):
        ts = evt.get("timestamp", 0)
        event_type = evt.get("event_type", "unknown")
        score = evt.get("form_score", 0)
        feedback = evt.get("feedback", "")
        key_obs = evt.get("key_observation", "")
        breakdown = evt.get("form_breakdown", {})

        events_text += f"\n  Event {i + 1}: {event_type} at {ts:.1f}s — Score: {score}/10"
        if key_obs:
            events_text += f"\n    Key observation: {key_obs}"
        events_text += f"\n    Feedback: {feedback}"
        if breakdown:
            events_text += f"\n    Breakdown: {json.dumps(breakdown)}"

    findings = analysis_result.get("findings", [])
    findings_text = ""
    if isinstance(findings, list):
        for finding in findings[:20]:
            if not isinstance(finding, dict):
                continue
            fid = finding.get("id", "?")
            start_ms = finding.get("start_ms", 0) or 0
            try:
                start_s = float(start_ms) / 1000.0
            except (TypeError, ValueError):
                start_s = 0.0
            findings_text += (
                f"\n  [{fid}] {finding.get('category', 'technique')} at {start_s:.1f}s"
                f" — severity {finding.get('severity', 'medium')}"
                f" ({finding.get('confidence_band', 'needs_review')} confidence)"
                f"\n    Observation: {finding.get('observation', '')}"
            )

    return f"""You are an expert sports coach and analyst. You have just completed a video analysis for an athlete. Below is the full analysis data. Use it to answer the athlete's follow-up questions.

ANALYSIS RESULTS:
- Sport: {sport}
- Form Score: {form_score}/10
- Overall Rating: {overall_rating}
- Summary: {summary}
- Priority Drill: {priority_drill or 'None provided'}
- Strengths: {', '.join(strengths) if strengths else 'None identified'}
- Top Tips: {', '.join(top_tips) if top_tips else 'None provided'}

DETECTED EVENTS ({len(shot_events)} total):{events_text}
{f'KEY FINDINGS:{findings_text}' if findings_text else ''}
RULES:
1. Answer ONLY based on the analysis data above. Do not invent events or data.
2. Reference specific timestamps (e.g., "At 12.3s...") and event numbers (e.g., "In Event 3...").
3. Be specific, actionable, and encouraging — like a real coach.
4. Use markdown for readability (bold, lists, etc.).
5. Keep responses concise (2-4 paragraphs max) unless the athlete asks for detail.
6. If the question goes beyond what the data supports, say so honestly.
7. When suggesting drills, make them specific to the athlete's actual weaknesses.
8. Format timestamps as seconds (e.g., 12.3s) for easy video navigation.
9. When a question matches a KEY FINDING, cite its id (e.g., [job:e2]) with its timestamp so the coach can click through to the evidence.
10. {GUARD_RULE}
11. Report wellness observations verbatim (fatigue, pain, injury-risk flags) but never diagnose, label, or predict medical conditions — no "overtrained", no injury predictions. Clinical interpretation is outside your authority.
12. Structure evidence-based answers as: Answer, then Evidence (timestamped citations like [job:e2] @ 12.5s), then Pattern (how often it occurred across recent events/matches), then Recommended focus (one concrete drill or cue)."""


def _format_history(history: list[dict[str, str]]) -> str:
    """Format conversation history into a readable block.

    Athlete-written turns are wrapped as untrusted (they may quote or paste
    anything); assistant turns stay plain trusted context.
    """
    if not history:
        return ""

    lines = ["CONVERSATION HISTORY:"]
    for msg in history[-10:]:  # Last 10 messages to stay in context
        role = msg.get("role", "user")
        content = msg.get("content", "")
        # Truncate very long messages
        if len(content) > 500:
            content = content[:500] + "..."
        if role == "user":
            lines.append(
                f"\nAthlete:\n{USER_OPEN}\n{content}\n{USER_CLOSE}"
            )
        else:
            lines.append(f"\nCoach: {content}")

    return "\n".join(lines)
