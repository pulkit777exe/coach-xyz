"""
chat_prompt.py — Prompt template for conversational follow-up on analysis results.

The chat prompt gives Gemini the original analysis context and conversation history,
then answers the user's question grounded in the data.
"""

from __future__ import annotations

import json
from typing import Any


def get_chat_prompt(
    analysis_result: dict[str, Any],
    conversation_history: list[dict[str, str]],
    user_message: str,
) -> list[dict[str, str]]:
    """
    Build a Gemini chat prompt with analysis context + conversation history.

    Returns a list of message dicts suitable for a multi-turn conversation.
    """
    system = _build_system_message(analysis_result)
    history = _format_history(conversation_history)

    messages: list[dict[str, str]] = [
        {"role": "user", "content": f"{system}\n\n{history}\n\nAthlete's question:\n{user_message}"},
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

RULES:
1. Answer ONLY based on the analysis data above. Do not invent events or data.
2. Reference specific timestamps (e.g., "At 12.3s...") and event numbers (e.g., "In Event 3...").
3. Be specific, actionable, and encouraging — like a real coach.
4. Use markdown for readability (bold, lists, etc.).
5. Keep responses concise (2-4 paragraphs max) unless the athlete asks for detail.
6. If the question goes beyond what the data supports, say so honestly.
7. When suggesting drills, make them specific to the athlete's actual weaknesses.
8. Format timestamps as seconds (e.g., 12.3s) for easy video navigation."""


def _format_history(history: list[dict[str, str]]) -> str:
    """Format conversation history into a readable block."""
    if not history:
        return ""

    lines = ["CONVERSATION HISTORY:"]
    for msg in history[-10:]:  # Last 10 messages to stay in context
        role = msg.get("role", "user")
        content = msg.get("content", "")
        prefix = "Athlete" if role == "user" else "Coach"
        # Truncate very long messages
        if len(content) > 500:
            content = content[:500] + "..."
        lines.append(f"\n{prefix}: {content}")

    return "\n".join(lines)
