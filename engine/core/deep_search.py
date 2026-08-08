"""
deep_search.py — Autonomous deep research engine.

Takes a vague user query, decomposes it into parallel search angles,
executes grounded web searches, synthesizes findings, dives deeper into
gaps, and returns a comprehensive research report with sources.

Architecture:
  Phase 1: Query decomposition → identify sub-queries & angles
  Phase 2: Parallel grounded searches across all angles
  Phase 3: Synthesis + gap identification
  Phase 4: Deep searches to fill gaps
  Phase 5: Final comprehensive report generation

Uses Gemini with Google Search grounding for all web access.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

from core.config import GEMINI_MODEL
from core.errors import EngineError, GeminiParseError

logger = logging.getLogger(__name__)

try:
    from google import genai
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_types = None


# ── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class Source:
    url: str
    title: str
    snippet: str = ""
    relevance: str = ""

@dataclass
class SearchAngle:
    query: str
    angle: str
    findings: str = ""
    sources: list[Source] = field(default_factory=list)

@dataclass
class GapQuery:
    question: str
    reason: str
    search_query: str

@dataclass
class DeepSearchResponse:
    query: str
    report: str
    sources: list[Source]
    angles_covered: list[str]
    searches_performed: int
    depth_reached: int
    total_time_seconds: float
    metadata: dict[str, Any] = field(default_factory=dict)


# ── Prompt Templates ────────────────────────────────────────────────────────

DECOMPOSITION_SYSTEM_PROMPT = """You are a research query decomposition expert.
Given a user's query (which may be vague or broad), break it down into the key
angles, sub-questions, and specific search queries needed to produce a
comprehensive research report.

Rules:
- Generate 4-7 distinct search angles that cover different facets of the query
- Each angle should have a specific, well-formed search query
- Think about: background/context, current state, comparisons, expert opinions,
  recent developments, counter-arguments, practical implications
- Search queries should be specific enough to return high-quality results
- Return ONLY valid JSON, no markdown fences

Output JSON format:
{
  "understood_intent": "one sentence describing what the user really wants",
  "angles": [
    {
      "angle": "short label for this research angle",
      "search_query": "the actual search query to use",
      "why": "why this angle matters"
    }
  ],
  "key_entities": ["entity1", "entity2"],
  "scope": "brief description of how broad this research should be"
}"""

GAP_ANALYSIS_SYSTEM_PROMPT = """You are a research gap analyst.
Given a topic and the findings gathered so far, identify what's missing,
what needs deeper investigation, and what follow-up questions would
significantly improve the quality of a comprehensive report.

Rules:
- Be specific about what information is missing
- Generate concrete search queries to fill each gap
- Prioritize gaps by impact on report quality
- Return ONLY valid JSON, no markdown fences

Output JSON format:
{
  "coverage_score": 0-10,
  "gaps": [
    {
      "question": "what specific information is missing",
      "reason": "why this gap matters for a comprehensive report",
      "search_query": "concrete search query to fill this gap"
    }
  ],
  "sufficient": true/false
}"""

REPORT_SYSTEM_PROMPT = """You are an expert research analyst producing a comprehensive,
well-structured report. You synthesize findings from multiple sources into
a coherent, insightful narrative.

Report structure:
1. Executive Summary (2-3 sentences)
2. Background & Context
3. Detailed Findings (organized by theme/angle)
4. Key Insights & Analysis
5. Comparisons & Contrasts (where relevant)
6. Current State & Recent Developments
7. Expert Perspectives & Consensus
8. Practical Implications
9. Controversies or Debates (if any)
10. Conclusion & Key Takeaways

Rules:
- Cite sources inline using [Source: Title] format
- Distinguish between facts, analysis, and speculation
- Present multiple viewpoints where they exist
- Be specific: include numbers, names, dates, URLs where available
- Markdown formatting with headers, bullet points, and bold for key terms
- Write for an intelligent non-expert audience
- Aim for thoroughness over brevity"""


# ── Core Engine ──────────────────────────────────────────────────────────────

class DeepSearchEngine:
    """Autonomous deep research engine using Gemini with Google Search grounding."""

    def __init__(
        self,
        max_angles: int = 6,
        max_depth: int = 2,
        max_gap_searches: int = 4,
        concurrency: int = 4,
        model: str | None = None,
    ):
        self.max_angles = max_angles
        self.max_depth = max_depth
        self.max_gap_searches = max_gap_searches
        self.concurrency = concurrency
        self.model = model or GEMINI_MODEL
        self._client: "genai.Client | None" = None
        self._semaphore: asyncio.Semaphore | None = None

    def _get_client(self) -> "genai.Client":
        if self._client is None:
            if genai is None:
                raise GeminiParseError("google-genai not installed")
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise EngineError("GEMINI_API_KEY missing", "AI key not configured", False)
            self._client = genai.Client(api_key=api_key)
        return self._client

    async def search(self, query: str) -> DeepSearchResponse:
        """Execute full deep research pipeline on a query."""
        start_time = time.time()
        self._semaphore = asyncio.Semaphore(self.concurrency)

        logger.info(f"[DeepSearch] Starting research: '{query}'")

        # Phase 1: Decompose
        decomposition = await self._decompose_query(query)
        angles = decomposition.get("angles", [])[: self.max_angles]
        logger.info(f"[DeepSearch] Decomposed into {len(angles)} angles")

        # Phase 2: Parallel search across all angles
        search_tasks = [
            self._search_angle(angle["angle"], angle["search_query"])
            for angle in angles
        ]
        angle_results: list[SearchAngle] = await asyncio.gather(*search_tasks)
        searches_done = len(angle_results)

        # Phase 3: Analyze gaps
        all_findings = "\n\n".join(
            f"## {r.angle}\n{r.findings}" for r in angle_results
        )
        gaps = await self._analyze_gaps(query, all_findings)

        # Phase 4: Deep searches for gaps
        depth = 1
        gap_results: list[SearchAngle] = []
        if not gaps.get("sufficient") and gaps.get("gaps"):
            gap_queries = gaps["gaps"][: self.max_gap_searches]
            logger.info(f"[DeepSearch] Filling {len(gap_queries)} research gaps")

            gap_tasks = [
                self._search_angle(
                    g["question"],
                    g["search_query"],
                )
                for g in gap_queries
            ]
            gap_results = await asyncio.gather(*gap_tasks)
            searches_done += len(gap_results)
            depth = 2

        # Phase 5: Generate final report
        report, all_sources = await self._generate_report(
            query, decomposition, angle_results, gap_results
        )

        elapsed = time.time() - start_time
        logger.info(
            f"[DeepSearch] Complete: {searches_done} searches, "
            f"depth={depth}, {len(all_sources)} sources, {elapsed:.1f}s"
        )

        return DeepSearchResponse(
            query=query,
            report=report,
            sources=all_sources,
            angles_covered=[r.angle for r in angle_results + gap_results],
            searches_performed=searches_done,
            depth_reached=depth,
            total_time_seconds=round(elapsed, 1),
            metadata={
                "understood_intent": decomposition.get("understood_intent", ""),
                "key_entities": decomposition.get("key_entities", []),
                "coverage_score": gaps.get("coverage_score", 0),
            },
        )

    async def _decompose_query(self, query: str) -> dict:
        """Phase 1: Break query into search angles."""
        prompt = f"Decompose this research query:\n\n{query}"

        response_text = await self._grounded_call(
            system_prompt=DECOMPOSITION_SYSTEM_PROMPT,
            user_message=prompt,
            temperature=0.3,
        )

        return self._parse_json_response(response_text, {
            "understood_intent": "",
            "angles": [],
            "key_entities": [],
            "scope": "",
        })

    async def _search_angle(self, angle: str, search_query: str) -> SearchAngle:
        """Execute a single grounded search for one research angle."""
        async with self._semaphore:
            prompt = (
                f"Search for comprehensive information about: {angle}\n\n"
                f"Specific search focus: {search_query}\n\n"
                "Provide a detailed summary of what you find, including "
                "specific facts, numbers, names, dates, and URLs. "
                "Include all relevant sources with their titles and URLs. "
                "Be thorough — this will be used in a comprehensive research report."
            )

            response_text = await self._grounded_call(
                system_prompt="You are a thorough web researcher. "
                "Search for the most relevant, up-to-date information. "
                "Provide detailed findings with source citations. "
                "Use markdown headers to organize different aspects.",
                user_message=prompt,
                temperature=0.2,
            )

            sources = self._extract_sources(response_text)

            return SearchAngle(
                query=search_query,
                angle=angle,
                findings=response_text,
                sources=sources,
            )

    async def _analyze_gaps(
        self, original_query: str, all_findings: str
    ) -> dict:
        """Phase 3: Identify research gaps."""
        prompt = (
            f"Original query: {original_query}\n\n"
            f"Findings gathered so far:\n{all_findings[:8000]}\n\n"
            "Analyze what's missing for a truly comprehensive report."
        )

        response_text = await self._grounded_call(
            system_prompt=GAP_ANALYSIS_SYSTEM_PROMPT,
            user_message=prompt,
            temperature=0.2,
        )

        return self._parse_json_response(response_text, {
            "coverage_score": 5,
            "gaps": [],
            "sufficient": True,
        })

    async def _generate_report(
        self,
        query: str,
        decomposition: dict,
        angle_results: list[SearchAngle],
        gap_results: list[SearchAngle],
    ) -> tuple[str, list[Source]]:
        """Phase 5: Synthesize everything into a comprehensive report."""
        all_results = angle_results + gap_results

        research_blocks = []
        for r in all_results:
            block = f"## {r.angle}\n\n{r.findings}"
            if r.sources:
                block += "\n\nSources found:\n"
                block += "\n".join(
                    f"- [{s.title}]({s.url})" for s in r.sources
                )
            research_blocks.append(block)

        research_material = "\n\n---\n\n".join(research_blocks)

        all_sources: list[Source] = []
        seen_urls: set[str] = set()
        for r in all_results:
            for s in r.sources:
                if s.url not in seen_urls:
                    all_sources.append(s)
                    seen_urls.add(s.url)

        sources_list = "\n".join(
            f"- [{s.title}]({s.url}) — {s.snippet[:100]}"
            for s in all_sources
        )

        prompt = (
            f"# Research Query\n{query}\n\n"
            f"## Understood Intent\n{decomposition.get('understood_intent', '')}\n\n"
            f"## Key Entities\n{', '.join(decomposition.get('key_entities', []))}\n\n"
            f"## Research Findings\n\n{research_material[:15000]}\n\n"
            f"## All Sources\n{sources_list}\n\n"
            "---\n"
            "Produce a comprehensive, well-structured research report "
            "synthesizing all the above findings. Follow the report structure "
            "defined in your system prompt. Cite sources inline."
        )

        report = await self._grounded_call(
            system_prompt=REPORT_SYSTEM_PROMPT,
            user_message=prompt,
            temperature=0.3,
        )

        return report, all_sources

    # ── Gemini Integration ───────────────────────────────────────────────────

    async def _grounded_call(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.3,
    ) -> str:
        """Make a Gemini call with Google Search grounding enabled."""
        client = self._get_client()

        if genai_types is None:
            raise GeminiParseError("google-genai types not available")

        def _call():
            try:
                config = genai_types.GenerateContentConfig(
                    temperature=temperature,
                    tools=[
                        genai_types.Tool(
                            google_search=genai_types.GoogleSearch()
                        )
                    ],
                )
            except AttributeError:
                # Fallback for SDK versions without GoogleSearch tool
                config = genai_types.GenerateContentConfig(
                    temperature=temperature,
                    tools=[genai_types.Tool(google_search_retrieval=True)],
                )

            return client.models.generate_content(
                model=self.model,
                contents=user_message,
                config=config,
            )

        try:
            response = await asyncio.to_thread(_call)
            text = getattr(response, "text", "") or ""

            # Extract grounding metadata if available
            grounding = self._extract_grounding_metadata(response)

            if grounding:
                text += "\n\n" + grounding

            return text
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            if status == 429:
                raise EngineError(
                    "GEMINI_QUOTA_EXCEEDED",
                    "AI quota exceeded. Try again later.",
                    True,
                )
            logger.error(f"[DeepSearch] Gemini error: {exc}")
            raise

    def _extract_grounding_metadata(self, response: Any) -> str:
        """Extract source citations from Gemini grounding metadata."""
        try:
            metadata = getattr(response, "metadata", None)
            if not metadata:
                return ""

            grounding = getattr(metadata, "grounding_metadata", None)
            if not grounding:
                return ""

            chunks = getattr(grounding, "grounding_chunks", None)
            if not chunks:
                return ""

            sources = []
            for chunk in chunks:
                web = getattr(chunk, "web", None)
                if web:
                    title = getattr(web, "title", "") or ""
                    uri = getattr(web, "uri", "") or ""
                    if uri:
                        sources.append(f"- [{title or uri}]({uri})")

            if sources:
                return "\n**Sources:**\n" + "\n".join(sources)
            return ""
        except Exception:
            return ""

    def _extract_sources(self, text: str) -> list[Source]:
        """Parse sources from a grounded response text."""
        sources = []
        try:
            import re
            # Match markdown links: [title](url)
            pattern = r'\[([^\]]+)\]\((https?://[^\)]+)\)'
            for match in re.finditer(pattern, text):
                title, url = match.group(1), match.group(2)
                # Skip image links and anchors
                if url.endswith(('.png', '.jpg', '.gif', '.svg')):
                    continue
                if url.startswith('#'):
                    continue
                sources.append(Source(url=url, title=title))
        except Exception:
            pass
        return sources

    def _parse_json_response(
        self, text: str, fallback: dict
    ) -> dict:
        """Parse JSON from Gemini response, with fallback."""
        try:
            # Strip markdown fences
            cleaned = text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
                cleaned = cleaned.strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()

            return json.loads(cleaned)
        except (json.JSONDecodeError, IndexError):
            # Try to find JSON object in the text
            try:
                start = cleaned.index("{")
                end = cleaned.rindex("}") + 1
                return json.loads(cleaned[start:end])
            except (ValueError, json.JSONDecodeError):
                logger.warning(f"[DeepSearch] Could not parse JSON response: {text[:200]}")
                return fallback


# ── Convenience Function ────────────────────────────────────────────────────

async def deep_search(
    query: str,
    max_angles: int = 6,
    max_depth: int = 2,
    max_gap_searches: int = 4,
) -> DeepSearchResponse:
    """Convenience function to run a deep search."""
    engine = DeepSearchEngine(
        max_angles=max_angles,
        max_depth=max_depth,
        max_gap_searches=max_gap_searches,
    )
    return await engine.search(query)


# ── CLI Entry Point ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    async def main():
        query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""
        if not query:
            print("Usage: python -m core.deep_search '<your research query>'")
            print("\nExample:")
            print('  python -m core.deep_search "latest developments in quantum computing 2025"')
            sys.exit(1)

        print(f"\n🔍 Deep Research Engine")
        print(f"Query: {query}")
        print(f"{'─' * 60}")

        result = await deep_search(query)

        print(f"\n{'═' * 60}")
        print(f"RESEARCH REPORT")
        print(f"{'═' * 60}")
        print(result.report)
        print(f"\n{'─' * 60}")
        print(f"Sources ({len(result.sources)}):")
        for s in result.sources:
            print(f"  • {s.title}: {s.url}")
        print(f"\nStats: {result.searches_performed} searches, "
              f"depth={result.depth_reached}, "
              f"{result.total_time_seconds}s")

    asyncio.run(main())
