"""Tests for core/storage.py — local storage paths and path-traversal guard."""

import pytest

from core import storage


@pytest.fixture()
def storage_root(tmp_path, monkeypatch):
    """Pin LOCAL_STORAGE_ROOT to a throwaway dir so tests never touch engine/tmp."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_ROOT", tmp_path)
    return tmp_path


class TestPathTraversalGuard:
    def test_plain_key_resolves_inside_root(self, storage_root):
        path = storage._key_to_local_path("videos/clip.mp4")
        assert path == storage_root / "videos" / "clip.mp4"

    def test_leading_slashes_are_stripped_safely(self, storage_root):
        path = storage._key_to_local_path("/videos/clip.mp4")
        assert path == storage_root / "videos" / "clip.mp4"

    def test_traversal_rejected(self, storage_root):
        with pytest.raises(ValueError, match="path traversal"):
            storage._key_to_local_path("../escape.mp4")
        with pytest.raises(ValueError, match="path traversal"):
            storage._key_to_local_path("a/../../etc/passwd")


class TestLocalStorageFlow:
    def test_upload_and_delete_roundtrip(self, storage_root):
        key = storage.upload_video(b"raw video bytes", "take1.mp4")

        path = storage.get_local_file_path(key)
        assert path is not None
        assert path.startswith(str(storage_root))
        with open(path, "rb") as f:
            assert f.read() == b"raw video bytes"

        storage.delete_file(key)
        assert storage.get_local_file_path(key) is None

    def test_missing_file_returns_none(self, storage_root):
        assert storage.get_local_file_path("does-not-exist.mp4") is None

    def test_download_video_to_tmp_raises_for_missing(self, storage_root):
        with pytest.raises(FileNotFoundError):
            storage.download_video_to_tmp("does-not-exist.mp4")
