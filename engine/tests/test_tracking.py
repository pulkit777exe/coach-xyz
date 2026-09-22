"""Unit tests for the scan↔track player-index contract.

The scan pipeline (detector.extract_players) assigns 1-based player_index
left-to-right by x_min. Tracking must resolve the same athlete for a given
index — never silently clamp to a different one.
"""

import pytest

from core.errors import NoPlayersDetectedError
from core.tracking import select_detection_by_index


def _det(x_min: float, width: float = 50.0):
    return ((x_min, 0.0, x_min + width, 200.0), 0.9)


class TestSelectDetectionByIndex:
    def test_selects_left_to_right_regardless_of_input_order(self):
        detections = [_det(300.0), _det(10.0), _det(150.0)]
        assert select_detection_by_index(detections, 1) == (10.0, 0.0, 60.0, 200.0)
        assert select_detection_by_index(detections, 2) == (150.0, 0.0, 200.0, 200.0)
        assert select_detection_by_index(detections, 3) == (300.0, 0.0, 350.0, 200.0)

    def test_ignores_box_size_when_ordering(self):
        # A large box on the right must NOT win over a small box on the left.
        detections = [_det(200.0, width=400.0), _det(5.0, width=20.0)]
        assert select_detection_by_index(detections, 1)[0] == 5.0

    def test_out_of_range_raises_instead_of_clamping(self):
        detections = [_det(10.0)]
        with pytest.raises(NoPlayersDetectedError):
            select_detection_by_index(detections, 2)
        with pytest.raises(NoPlayersDetectedError):
            select_detection_by_index(detections, 0)
        with pytest.raises(NoPlayersDetectedError):
            select_detection_by_index([], 1)
