"""Rendering must not be the stage that fails a job.

`render_video` released `cap` and `writer` at the *end* of the function, after
the frame loop, so any exception from inside it leaked both handles and left an
unfinalised mp4 behind.

The reachable trigger is a numeric-string `form_score`. Gemini returns
`session_summary.average_form_score` as the string "8.5", and it reaches the
renderer intact through every gate:

- `validator.validate_analysis` checks SUMMARY_FIELDS for *presence* only, never
  type — returns no errors.
- `normalize_gemini_result` passes it through verbatim; `_stage_scoring`
  overwrites `success_rate_percent` / `average_form_score` / `total_events` but
  not `form_score`.
- `quality_check` coerces with `_as_float("8.5")`, gets 8.5, sees it in [0, 10],
  and raises nothing.

Then `_draw_hud` did `int("8.5")` -> ValueError, escaping the loop with both
handles open. The stage's own docstring says the gate "never blocks — a flawed
analysis degrades to human review instead of failing the job"; in practice a
numeric-string score escalated to a hard failure at the most expensive stage.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from core.renderer import _coerce_score


class TestCoerceScore:
    def test_a_numeric_string_is_accepted(self) -> None:
        # The exact value that used to raise ValueError.
        assert _coerce_score("8.5") == 8

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (8, 8),
            (8.7, 8),
            ("8.7", 8),
            (0, 0),
            ("0", 0),
            (None, 0),
            ("", 0),
            ("not a number", 0),
            ([], 0),
            ({}, 0),
            (True, 0),
            (False, 0),
        ],
    )
    def test_every_shape_renders_as_a_number(self, value: object, expected: int) -> None:
        result = _coerce_score(value)
        assert result == expected
        assert isinstance(result, int)

    def test_it_never_raises(self) -> None:
        for value in (object(), float("nan"), float("inf"), [1, 2], {"a": 1}, b"x"):
            assert isinstance(_coerce_score(value), int)


class TestRenderVideoReleasesHandles:
    def test_a_failure_inside_the_frame_loop_releases_and_cleans_up(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import core.renderer as renderer

        released: list[str] = []

        class _Cap:
            def __init__(self) -> None:
                self._frames = 0

            def read(self):
                self._frames += 1
                if self._frames > 2:
                    return False, None
                return True, np.zeros((8, 8, 3), dtype=np.uint8)

            def isOpened(self) -> bool:
                return True

            def get(self, _prop) -> float:
                return 30.0

            def release(self) -> None:
                released.append("cap")

        class _Writer:
            def write(self, _frame) -> None:
                return None

            def isOpened(self) -> bool:
                return True

            def release(self) -> None:
                released.append("writer")

        output = tmp_path / "out.mp4"
        output.write_bytes(b"partial")

        def _explode(*_a, **_k):
            raise ValueError("invalid literal for int() with base 10: '8.5'")

        monkeypatch.setattr(renderer, "_draw_hud", _explode)
        monkeypatch.setattr(renderer.cv2, "VideoCapture", lambda *_a, **_k: _Cap())
        monkeypatch.setattr(renderer.cv2, "VideoWriter", lambda *a, **k: _Writer())

        with pytest.raises(ValueError):
            renderer.render_video(
                video_path=str(tmp_path / "in.mp4"),
                output_path=str(output),
                analysis_result={"form_score": "8.5"},
                active_player_landmarks_per_frame=[],
                fps=30.0,
                sport="basketball",
            )

        assert sorted(released) == ["cap", "writer"], "a handle leaked on the failure path"
        assert not output.exists(), "the partial video was left behind"

    def test_the_success_path_still_produces_the_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import core.renderer as renderer

        released: list[str] = []
        output = tmp_path / "out.mp4"

        class _Cap:
            def __init__(self) -> None:
                self._frames = 0

            def read(self):
                self._frames += 1
                if self._frames > 2:
                    return False, None
                return True, np.zeros((8, 8, 3), dtype=np.uint8)

            def isOpened(self) -> bool:
                return True

            def get(self, _prop) -> float:
                return 30.0

            def release(self) -> None:
                released.append("cap")

        class _Writer:
            def __init__(self) -> None:
                self.written = 0

            def isOpened(self) -> bool:
                return True

            def write(self, _frame) -> None:
                self.written += 1

            def release(self) -> None:
                released.append("writer")

        monkeypatch.setattr(renderer, "_draw_hud", lambda *a, **k: None)
        monkeypatch.setattr(renderer, "_draw_summary_screen", lambda frame, *a: frame)
        # render_video opens a VideoCapture/VideoWriter, which needs a decodable
        # file on disk, so both handles are injected instead.
        monkeypatch.setattr(renderer.cv2, "VideoCapture", lambda *_a, **_k: _Cap())
        monkeypatch.setattr(renderer.cv2, "VideoWriter", lambda *a, **k: _Writer())

        result = renderer.render_video(
            video_path=str(tmp_path / "in.mp4"),
            output_path=str(output),
            analysis_result={"form_score": "8.5"},
            active_player_landmarks_per_frame=[],
            fps=30.0,
            sport="basketball",
        )

        assert result == str(output)
        assert sorted(released) == ["cap", "writer"]
