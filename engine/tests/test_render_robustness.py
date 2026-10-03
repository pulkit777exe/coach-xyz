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

That fix left `_draw_summary_screen` one function over: it still did
`int(analysis_result.get("form_score", 0) or 0)`, so the SAME value raised at the
single hold frame drawn after every frame of the video had been rendered and
written — strictly later, and strictly more work already paid for, than the line
it duplicated. Both paths now go through `_coerce_score`, and the tests below
pin that the stringly-typed score renders as the number it coerces to, and that
the summary-screen failure path still deletes the half-written output.
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

    def test_a_numeric_string_score_is_coerced_rather_than_raising(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The whole point of item B: with the coercion in place this run reaches
        # the writer, produces the hold frames and KEEPS its output. Before the
        # fix, `_draw_summary_screen` raised ValueError on the same payload one
        # function later, and the file was deleted by the except branch.
        import core.renderer as renderer

        output = tmp_path / "out.mp4"
        released: list[str] = []
        written: list[int] = []

        class _Cap:
            def __init__(self) -> None:
                self._frames = 0

            def read(self):
                self._frames += 1
                if self._frames > 2:
                    return False, None
                return True, np.zeros((64, 64, 3), dtype=np.uint8)

            def isOpened(self) -> bool:
                return True

            def get(self, _prop) -> float:
                return 30.0

            def release(self) -> None:
                released.append("cap")

        class _Writer:
            def __init__(self) -> None:
                self._n = 0

            def isOpened(self) -> bool:
                return True

            def write(self, _frame) -> None:
                self._n += 1
                written.append(self._n)

            def release(self) -> None:
                released.append("writer")

        monkeypatch.setattr(renderer.cv2, "VideoCapture", lambda *_a, **_k: _Cap())
        monkeypatch.setattr(renderer.cv2, "VideoWriter", lambda *a, **k: _Writer())

        result = renderer.render_video(
            video_path=str(tmp_path / "in.mp4"),
            output_path=str(output),
            analysis_result={"form_score": "8.5", "sport": "basketball"},
            active_player_landmarks_per_frame=[],
            fps=30.0,
            sport="basketball",
        )

        assert result == str(output)
        # 2 clip frames + the hold frames, so the summary screen definitely ran.
        assert len(written) > 2, "the hold frames were never written"
        assert sorted(released) == ["cap", "writer"]

    def test_a_failure_in_the_summary_screen_still_deletes_the_partial_output(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The half-written output is dropped, whichever function inside the
        # summary screen raised. Before the coercion fix that function WAS
        # `_draw_summary_screen` itself for any numeric-string score — the
        # cleanup this asserts is what that path relied on, so it has to keep
        # working now that the raise itself is gone.
        import core.renderer as renderer

        released: list[str] = []
        output = tmp_path / "out.mp4"
        output.write_bytes(b"partial")

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

        def _explode(*_a, **_k):
            raise RuntimeError("summary screen blew up")

        monkeypatch.setattr(renderer, "_draw_score_ring", _explode)
        monkeypatch.setattr(renderer.cv2, "VideoCapture", lambda *_a, **_k: _Cap())
        monkeypatch.setattr(renderer.cv2, "VideoWriter", lambda *a, **k: _Writer())

        with pytest.raises(RuntimeError):
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


class TestSummaryScreenCoercesTheScore:
    """`_draw_summary_screen` reads the same model-supplied score `_draw_hud` does.

    It used to do `int(value or 0)` — the one function the first `_coerce_score`
    fix missed, so the stringly-typed score survived the whole frame loop and
    raised at the single hold frame drawn afterwards.
    """

    def test_a_numeric_string_renders_exactly_as_the_int_it_coerces_to(self) -> None:
        import core.renderer as renderer

        base = {
            "sport": "basketball",
            "overall_rating": "good",
            "summary": "Solid knee drive and a clean release.",
            "top_tips": ["Widen your base on the drive."],
        }
        colors = renderer._sport_colors("basketball")
        rng = np.random.default_rng(3)
        frame = rng.integers(0, 255, size=(180, 320, 3), dtype=np.uint8)

        as_string = renderer._draw_summary_screen(
            frame.copy(), {**base, "form_score": "8.5"}, colors
        )
        as_int = renderer._draw_summary_screen(frame.copy(), {**base, "form_score": 8}, colors)
        assert np.array_equal(as_string, as_int), "the string path rendered something else"

    @pytest.mark.parametrize(
        "value",
        ["8.5", "8", 8, 8.7, 0, "0", None, "", "not a number", [], {}, True, False, float("nan")],
    )
    def test_no_shape_of_score_raises(self, value: object) -> None:
        import core.renderer as renderer

        colors = renderer._sport_colors("football")
        frame = np.zeros((180, 320, 3), dtype=np.uint8)
        out = renderer._draw_summary_screen(frame, {"form_score": value}, colors)
        assert out.shape == frame.shape

    def test_the_hud_and_the_summary_screen_agree_on_the_score(self) -> None:
        # One SSOT, asserted rather than assumed: same payload, same coercion.
        import core.renderer as renderer

        payload = {"sport": "basketball", "form_score": "7.9", "overall_rating": "good",
                   "summary": "s", "top_tips": ["t"]}
        colors = renderer._sport_colors("basketball")

        seen: list[int] = []
        real_ring = renderer._draw_score_ring

        def _capture(frame, cx, cy, radius, form_score, score_color):
            seen.append(form_score)
            return real_ring(frame, cx, cy, radius, form_score, score_color)

        renderer._draw_score_ring = _capture
        try:
            renderer._draw_summary_screen(
                np.zeros((180, 320, 3), dtype=np.uint8), payload, colors
            )
        finally:
            renderer._draw_score_ring = real_ring

        assert seen == [_coerce_score(payload["form_score"])] == [7]

    def test_an_absent_score_is_zero_and_draws_no_arc(self) -> None:
        # `_draw_score_ring` skips the arc entirely at 0, so this pins the
        # falsy-value coercion rather than just "it did not raise".
        import core.renderer as renderer

        colors = renderer._sport_colors("cricket")
        zero = np.zeros((180, 320, 3), dtype=np.uint8)
        no_score = renderer._draw_summary_screen(zero.copy(), {"sport": "cricket"}, colors)
        explicit_zero = renderer._draw_summary_screen(
            zero.copy(), {"sport": "cricket", "form_score": 0}, colors
        )
        assert np.array_equal(no_score, explicit_zero)
