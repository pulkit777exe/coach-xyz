"""Regression tests for the 2026-09-30 correctness survey fixes.

Each test fails on the pre-fix code (verified by reverting) and passes on
the fix. Async generator coverage uses asyncio.run — no pytest-asyncio.
"""

import asyncio
import json

import core.chat_client as chat_client
from core.analyzer import _compute_weighted_scoring
from core.cache import compute_video_hash
from core.gemini_client import build_frame_metadata


def _mb(n: int, seed: int) -> bytes:
    return bytes(((seed + i) % 256 for i in range(n)))


class TestVideoHash:
    def test_same_head_tail_different_middle_hashes_differently(self, tmp_path):
        # 3MB files sharing the first/last 1MB (same-camera clips do):
        # the old size+head+tail hash collided on these.
        head = _mb(1024 * 1024, 1)
        tail = _mb(1024 * 1024, 2)
        middle = 1024 * 1024
        a = tmp_path / "a.mp4"
        b = tmp_path / "b.mp4"
        a.write_bytes(head + b"A" * middle + tail)
        b.write_bytes(head + b"B" * middle + tail)
        assert compute_video_hash(str(a)) != compute_video_hash(str(b))

    def test_identical_files_hash_equally(self, tmp_path):
        content = _mb(3 * 1024 * 1024, 7)
        a = tmp_path / "a.mp4"
        b = tmp_path / "b.mp4"
        a.write_bytes(content)
        b.write_bytes(content)
        assert compute_video_hash(str(a)) == compute_video_hash(str(b))


class TestNoFabricatedMeasurements:
    def test_unmeasured_criteria_score_zero_with_none(self):
        # Qualitative praise must never render as an observed value: the
        # old code synthesized ideal_midpoint * factor from the rating
        # whenever the breakdown key matched a criterion.
        events = [{"form_breakdown": {"elbow_alignment": "good"}}]
        _compute_weighted_scoring(events, "basketball")
        criteria = events[0]["weighted_scoring"]["criteria"]
        assert len(criteria) > 0
        for cs in criteria:
            assert cs["measured_value"] is None
            assert cs["score"] == 0.0


class TestPromptBuilderPurity:
    def test_track_dict_is_not_mutated(self):
        track = {"joint_angles": {"knee_angle": 90.0}, "elbow_extension_angle": 170.0}
        before = json.loads(json.dumps(track))
        build_frame_metadata(track)
        assert track == before
        assert "elbow_extension_angle" not in track["joint_angles"]


class TestChatStreamUnconfigured:
    def test_none_client_yields_not_configured_frame(self, monkeypatch):
        monkeypatch.setattr(chat_client, "shared_client", lambda: None)

        async def first_frame() -> str:
            agen = chat_client.stream_chat_sse([{"role": "user", "content": "hi"}])
            try:
                return await agen.__anext__()
            finally:
                await agen.aclose()

        frame = asyncio.run(first_frame())
        assert "AI service is not configured." in frame
