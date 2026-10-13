"""Scan-window cap: the best-frame sweep never exceeds MAX_SCAN_SAMPLES."""

import numpy as np

from core.config import MAX_SCAN_SAMPLES
from core.detector import scan_timestamps


class TestScanTimestamps:
    def test_short_video_keeps_one_hz_stride(self):
        ts = scan_timestamps(10.0)
        assert list(ts) == pytest_approx_range(0.0, 10.0, 1.0)

    def test_long_video_is_capped_but_spans_the_window(self):
        ts = scan_timestamps(3600.0)
        assert len(ts) == MAX_SCAN_SAMPLES
        assert ts[0] == 0.0
        assert ts[-1] == 3600.0

    def test_unknown_duration_falls_back_to_sixty_seconds(self):
        ts = scan_timestamps(0.0)
        assert len(ts) <= MAX_SCAN_SAMPLES
        assert ts[-1] == 60.0


def pytest_approx_range(start: float, stop: float, step: float) -> list:
    return list(np.arange(start, stop + 0.01, step))
