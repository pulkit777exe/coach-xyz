"""Tests for core/config.py — shared constants and timestamp parsing."""

from core.config import CHUNK_SIZE, MAX_FILE_SIZE_BYTES, parse_timestamp


class TestParseTimestamp:
    def test_parses_minutes_and_seconds(self):
        assert parse_timestamp("0:08") == 8.0
        assert parse_timestamp("1:30") == 90.0
        assert parse_timestamp("12:05.5") == 725.5

    def test_parses_plain_seconds(self):
        assert parse_timestamp("42") == 42.0
        assert parse_timestamp("8.5") == 8.5

    def test_returns_zero_for_malformed_input(self):
        assert parse_timestamp("") == 0.0
        assert parse_timestamp("abc") == 0.0
        assert parse_timestamp("1:2:3") == 0.0


class TestConstants:
    def test_file_size_limits(self):
        assert MAX_FILE_SIZE_BYTES == 500 * 1024 * 1024
        assert CHUNK_SIZE == 8 * 1024 * 1024
