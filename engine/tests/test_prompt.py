"""core/prompt.py — the system prompt sent to Gemini.

This module is the only place the model's *contract* is stated: the sport
sections it must enumerate, the JSON schema it must return, and the player-focus
and chunk-context instructions that override it. A branch here that silently
stops firing does not fail a test — it produces a plausible-looking analysis of
the wrong thing, which is the most expensive kind of bug in this engine.

Covered:
  - the three-way sport dispatch (`auto` / a named sport / an unknown name), and
    the fact that `auto` and unknown-sport are *byte-identical* (a fallback that
    has drifted from its intended twin would be invisible);
  - each named sport gets **only** its own checklist — the whole point of the
    dispatch is that a cricket clip is not told to look for a three-pointer;
  - `player_focus` and `chunk_info` are optional, and their placeholders fall
    back rather than printing `None` into the prompt;
  - the timestamp formatter, including the `0:05.00` zero-padding that a naive
    `{sec}` would lose;
  - the schema placeholder is filled from the canonical sport list, so a new
    sport added to `core.sport_config` reaches the model without a second edit
    here — plus a parity guard so the three per-sport dicts cannot fall out of
    step with each other.
"""

from __future__ import annotations

import re

import pytest

from core.prompt import (
    _EVENT_DETECTION_ALL,
    _EVENT_DETECTION_SPORTS,
    _FORM_CHECKLIST_SPORTS,
    _OUTPUT_FORMAT,
    _SPORT_SECTIONS,
    _SPORT_SPECIFIC_STATS_SPORTS,
    _chunk_context_section,
    _player_focus_section,
    get_system_prompt,
)
from core.sport_config import SPORTS

ALL_SPORTS = sorted(_SPORT_SECTIONS)

# ── Sport dispatch ───────────────────────────────────────────────────────────


class TestSportDispatch:
    def test_auto_includes_every_sport(self):
        prompt = get_system_prompt(sport="auto")
        for sport in SPORTS:
            assert _SPORT_SECTIONS <= set() or sport in prompt

    def test_auto_and_an_unknown_sport_name_are_identical(self):
        """The `else` branch is a copy of the `auto` branch. If one ever gains a
        section the other does not, the fallback silently sends a different
        prompt than the caller asked for."""
        assert get_system_prompt(sport="auto") == get_system_prompt(sport="quidditch")

    @pytest.mark.parametrize("empty_like", ["", " ", "Basketball", "BASKETBALL", "basket ball"])
    def test_an_unrecognised_name_falls_back_to_all_rather_than_raising(self, empty_like):
        # The lookup is exact and case-sensitive, so a near-miss is a miss.
        assert get_system_prompt(sport=empty_like) == get_system_prompt(sport="auto")

    @pytest.mark.parametrize("sport", ALL_SPORTS)
    def test_a_named_sport_gets_exactly_its_own_sections(self, sport):
        prompt = get_system_prompt(sport=sport)
        others = [s for s in ALL_SPORTS if s != sport]
        for other in others:
            assert not _has_section_for(prompt, other), (
                f"{sport} prompt mentions {other}'s checklist"
            )
        assert _has_section_for(prompt, sport)

    @pytest.mark.parametrize("sport", ALL_SPORTS)
    def test_the_sport_prompt_is_shorter_than_the_all_sports_prompt(self, sport):
        # One sport's checklist plus one sport's stat keys, versus all six.
        assert len(get_system_prompt(sport=sport)) < len(get_system_prompt(sport="auto"))

    @pytest.mark.parametrize("sport", ALL_SPORTS)
    def test_a_named_sport_still_carries_the_shared_boilerplate(self, sport):
        prompt = get_system_prompt(sport=sport)
        for heading in ("## FEEDBACK WRITING RULES", "## SESSION SUMMARY", "## OUTPUT FORMAT", "## CRITICAL RULES"):
            assert heading in prompt, heading

    @pytest.mark.parametrize("sport", ALL_SPORTS)
    def test_a_named_sport_still_carries_the_output_schema(self, sport):
        """The sport dispatch chooses the *instructions*, never the contract."""
        assert '"session_summary"' in get_system_prompt(sport=sport)
        assert '"form_breakdown"' in get_system_prompt(sport=sport)


def _has_section_for(prompt: str, sport: str) -> bool:
    """True when the prompt carries that sport's event-detection heading.

    The heading (`### Cricket events to detect:`) is the only marker unique to a
    sport — several stat keys are shared across sports (`total_goals_so_far`
    belongs to both football and hockey), so a stat key cannot discriminate.
    """
    return f"### {_display_name(sport)} events to detect:" in prompt


# ── Schema placeholder ───────────────────────────────────────────────────────


class TestOutputFormatSchema:
    def test_the_sports_placeholder_is_filled_not_left_literal(self):
        assert "__SPORTS__" not in _OUTPUT_FORMAT

    def test_the_schema_lists_every_canonical_sport(self):
        for sport in SPORTS:
            assert f"<{sport}|" in _OUTPUT_FORMAT or sport in _OUTPUT_FORMAT

    def test_the_schema_names_the_pose_and_medical_fields_the_pipeline_reads(self):
        # These are what `validator`, `findings` and the renderer consume.
        for key in ("elbow_extension_angle", "joint_angles", "injury_risk", "weighted_scoring"):
            assert f'"{key}"' in _OUTPUT_FORMAT, key

    def test_the_schema_forbids_markdown_fences(self):
        assert "no markdown fences" in _OUTPUT_FORMAT


# ── Player focus ─────────────────────────────────────────────────────────────


class TestPlayerFocusSection:
    def test_it_names_the_player_and_position(self):
        section = _player_focus_section({"id": 2, "position": "left side", "color_hex": "#ff0000"})
        assert "Player 2" in section
        assert "left side" in section

    def test_a_missing_id_does_not_print_none(self):
        """`pf.get('id', '?')` — the fallback is what keeps the sentence
        grammatical when a caller passes only a position."""
        section = _player_focus_section({"position": "centre"})
        assert "Player ?" in section
        assert "None" not in section

    def test_a_missing_position_falls_back_to_the_frame(self):
        section = _player_focus_section({"id": 1})
        assert "**the frame**" in section

    def test_an_empty_dict_still_produces_a_usable_section(self):
        section = _player_focus_section({})
        assert "Player ?" in section
        assert "the frame" in section

    def test_it_is_appended_to_the_prompt_when_supplied(self):
        assert "## ⚠️  PLAYER FOCUS — CRITICAL" in get_system_prompt(
            player_focus={"id": 1, "position": "left"}
        )

    def test_it_is_absent_when_not_supplied(self):
        # Critical rule 9 *mentions* "PLAYER FOCUS" whether or not the section
        # is present, so the marker has to be the heading, not the bare words.
        assert "## ⚠️  PLAYER FOCUS — CRITICAL" not in get_system_prompt()

    def test_an_empty_dict_is_falsy_so_no_section_is_appended(self):
        # `if player_focus:` — `{}` is skipped, while `{"id": 1}` is not.
        assert "## ⚠️  PLAYER FOCUS — CRITICAL" not in get_system_prompt(player_focus={})
        assert "## ⚠️  PLAYER FOCUS — CRITICAL" in get_system_prompt(
            player_focus={"id": 1}
        )


# ── Chunk context ────────────────────────────────────────────────────────────


class TestChunkContextSection:
    def test_the_chunk_index_is_one_based_in_the_prose(self):
        """`index + 1` — Gemini is told "chunk 1 of 3", not "chunk 0 of 3", so
        the model's numbering matches the client's."""
        section = _chunk_context_section({"index": 0, "total_chunks": 3})
        assert "chunk 1 of 3" in section

    def test_timestamps_are_zero_padded_to_two_places(self):
        section = _chunk_context_section({"start_seconds": 5.0, "end_seconds": 65.25})
        assert "0:05.00" in section
        assert "1:05.25" in section

    def test_the_offset_is_carried_into_the_clip_start_clarifier(self):
        section = _chunk_context_section({"start_seconds": 65.0, "end_seconds": 130.0})
        assert "0:00 means 1:05.00" in section

    def test_a_missing_index_defaults_to_the_first_chunk(self):
        assert "chunk 1 of 1" in _chunk_context_section({})

    def test_a_missing_total_defaults_to_one(self):
        assert " of 1" in _chunk_context_section({"index": 4})

    def test_it_is_appended_to_the_prompt_when_supplied(self):
        assert "## VIDEO CHUNK CONTEXT" in get_system_prompt(
            chunk_info={"index": 1, "total_chunks": 4}
        )

    def test_it_is_absent_when_not_supplied(self):
        assert "## VIDEO CHUNK CONTEXT" not in get_system_prompt()

    @pytest.mark.parametrize(
        "start,end,expected",
        [(0, 0, "0:00.00"), (60, 120, "1:00.00"), (3600, 3661, "60:00.00"), (59.99, 119.99, "0:59.99")],
    )
    def test_the_minutes_field_rolls_over_without_wrapping(self, start, end, expected):
        assert expected in _chunk_context_section({"start_seconds": start, "end_seconds": end})

    def test_a_fractional_second_rounds_up_into_a_sixty_second_clock(self):
        """CHARACTERISATION of a latent formatting defect (prompt.py:101-104).

        `sec = s % 60` leaves the float un-truncated and `{:05.2f}` then rounds
        it: 59.999 prints as `0:60.00`, and 119.999 as `1:60.00`. There is no
        60th second, so the prompt would show Gemini a timestamp outside the
        format critical rule 1 tells it to emit.

        Latent, not live: the only caller (`cli/chunker._split_video`) accumulates
        `start_s` by `chunk_duration_s - chunk_overlap_s`, both env-parsed as
        `int`, so `start_seconds` is always a whole number of seconds and never
        reaches 59.999. Pinned so that a fractional chunk boundary — a
        frame-accurate split, a non-default overlap — cannot introduce it
        unnoticed. Correct behaviour is to round first and re-derive the minute,
        or to floor the seconds to hundredths.
        """
        section = _chunk_context_section({"start_seconds": 59.999, "end_seconds": 119.999})
        assert "0:60.00" in section
        assert "1:60.00" in section


# ── Composition ──────────────────────────────────────────────────────────────


class TestPromptComposition:
    def test_the_base_instruction_leads_the_prompt(self):
        assert get_system_prompt().startswith("You are an elite sports performance analyst")

    def test_player_focus_precedes_chunk_context(self):
        prompt = get_system_prompt(
            player_focus={"id": 1, "position": "left"}, chunk_info={"index": 0, "total_chunks": 2}
        )
        assert prompt.index("## ⚠️  PLAYER FOCUS — CRITICAL") < prompt.index("## VIDEO CHUNK CONTEXT")

    def test_both_optional_sections_can_be_present_together(self):
        prompt = get_system_prompt(player_focus={"id": 1}, chunk_info={"index": 0})
        assert "## ⚠️  PLAYER FOCUS — CRITICAL" in prompt
        assert "## VIDEO CHUNK CONTEXT" in prompt

    def test_the_prompt_is_a_single_joined_string_with_no_none_placeholders(self):
        for kwargs in (
            {},
            {"player_focus": {"id": 1, "position": "left"}},
            {"chunk_info": {"index": 0, "total_chunks": 2}},
            {"player_focus": {}, "chunk_info": {}},
            {"sport": "basketball"},
        ):
            prompt = get_system_prompt(**kwargs)
            assert isinstance(prompt, str)
            assert "None" not in prompt, kwargs

    def test_the_critical_rules_reference_both_optional_sections(self):
        # Rules 9 and 10 tell the model to obey them; if a rule were dropped the
        # section would still be sent but no longer binding.
        rules = get_system_prompt().split("## CRITICAL RULES")[1]
        assert "PLAYER FOCUS" in rules
        assert "VIDEO CHUNK CONTEXT" in rules

    def test_every_sport_is_named_in_the_detection_preamble(self):
        preamble = get_system_prompt().split("## SPORT DETECTION")[1].split("## EVENT")[0]
        for sport in SPORTS:
            assert sport in preamble, sport

    def test_the_football_name_is_spelled_out_for_the_model(self):
        # SPORTS carries "football"; the prompt has to disambiguate it from
        # American football or the model will look for a quarterback.
        assert "Football (Soccer)" in get_system_prompt()


# ── Cross-module parity ──────────────────────────────────────────────────────


class TestSportSectionParity:
    def test_the_three_per_sport_dicts_have_the_same_keys(self):
        """`get_system_prompt` indexes all three by the same `sport` string
        (`_EVENT_DETECTION_SPORTS[sport]`, then the two others). A key present in
        one and missing from another raises KeyError only for that sport, in
        production, on the first clip of that sport."""
        assert set(_EVENT_DETECTION_SPORTS) == set(_FORM_CHECKLIST_SPORTS) == set(
            _SPORT_SPECIFIC_STATS_SPORTS
        )

    def test_the_per_sport_keys_are_a_subset_of_the_canonical_vocabulary(self):
        for sport in _SPORT_SECTIONS:
            assert sport in SPORTS, sport

    def test_the_sections_set_is_derived_from_the_event_dict(self):
        assert _SPORT_SECTIONS == set(_EVENT_DETECTION_SPORTS)

    def test_the_all_sports_event_rules_mention_every_named_sport(self):
        for sport in ALL_SPORTS:
            heading = f"### {_display_name(sport)} events to detect"
            assert heading in _EVENT_DETECTION_ALL, heading

    @pytest.mark.parametrize("sport", ALL_SPORTS)
    def test_each_named_sport_block_mentions_its_own_stat_keys(self, sport):
        block = _SPORT_SPECIFIC_STATS_SPORTS[sport]
        keys = re.findall(r"^- ([a-z_]+)$", block, flags=re.MULTILINE)
        assert keys, sport
        assert all(k in get_system_prompt(sport=sport) for k in keys)

    @pytest.mark.parametrize("sport", ALL_SPORTS)
    def test_each_named_sport_event_block_asks_for_a_timestamp(self, sport):
        assert "Timestamp" in _EVENT_DETECTION_SPORTS[sport]


def _display_name(sport: str) -> str:
    return "Football (Soccer)" if sport == "football" else sport.title()
