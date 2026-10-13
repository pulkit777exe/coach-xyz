"""Tests for the storage backend seam (LocalBackend/S3Backend + delegates)."""

import os

import pytest

from core import storage
from core.storage import LocalBackend, S3Backend, get_backend


@pytest.fixture()
def storage_root(tmp_path, monkeypatch):
    """Pin LOCAL_STORAGE_ROOT to a throwaway dir so tests never touch engine/tmp."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_ROOT", tmp_path)
    return tmp_path


@pytest.fixture()
def local_env(monkeypatch):
    monkeypatch.delenv("STORAGE_BACKEND", raising=False)


@pytest.fixture()
def s3_env(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "s3")


class TestGetBackend:
    def test_local_by_default(self, local_env):
        assert isinstance(get_backend(), LocalBackend)

    def test_s3_when_configured(self, s3_env):
        assert isinstance(get_backend(), S3Backend)

    def test_backend_names(self):
        assert LocalBackend().name == "local"
        assert S3Backend().name == "s3"


class TestLocalBackend:
    def test_discard_tmp_copy_never_deletes(self, storage_root, local_env):
        key = storage.upload_video(b"keep me", "keep.mp4")
        path = storage.get_local_file_path(key)
        assert path is not None
        storage.discard_tmp_copy(path)
        assert os.path.exists(path)

    def test_discard_tmp_copy_tolerates_none(self, local_env):
        storage.discard_tmp_copy(None)

    def test_mint_upload_is_multipart(self, local_env):
        assert storage.mint_upload("raw/s/a/k.mp4", "video/mp4") == {"mode": "multipart"}

    def test_resolve_download_returns_files(self, storage_root, local_env):
        key = storage.upload_video(b"bytes", "res.mp4")
        assert storage.resolve_download(key) == ("file", storage.get_local_file_path(key))

    def test_resolve_download_missing_raises(self, storage_root, local_env):
        with pytest.raises(FileNotFoundError):
            storage.resolve_download("does-not-exist.mp4")


class TestS3Backend:
    def test_local_path_or_none_is_none(self, s3_env):
        assert S3Backend().local_path_or_none("results/x.mp4") is None

    def test_mint_upload_shapes_presigned_posts(self, s3_env, monkeypatch):
        monkeypatch.setattr(
            storage,
            "presigned_upload",
            lambda key, mime: {"url": "https://up", "fields": {"k": "v"}, "key": key},
        )
        assert storage.mint_upload("raw/s/a/k.mp4", "video/mp4") == {
            "mode": "presigned",
            "url": "https://up",
            "fields": {"k": "v"},
        }

    def test_resolve_download_returns_redirect_urls(self, s3_env, monkeypatch):
        monkeypatch.setattr(storage, "presigned_download", lambda key: "https://dl/x.mp4")
        assert storage.resolve_download("results/x.mp4") == ("url", "https://dl/x.mp4")

    def test_discard_tmp_copy_removes_only_managed_copies(self, s3_env, tmp_path):
        inside = tmp_path / "copy.mp4"
        inside.write_bytes(b"x")
        # Managed copy: point TMP_ROOT at the throwaway dir for the call.
        real_tmp = storage.TMP_ROOT
        try:
            storage.TMP_ROOT = tmp_path
            S3Backend().discard_tmp_copy(str(inside))
            assert not inside.exists()
        finally:
            storage.TMP_ROOT = real_tmp

    def test_discard_tmp_copy_refuses_foreign_paths(self, s3_env, tmp_path):
        foreign = tmp_path / "keep.mp4"
        foreign.write_bytes(b"x")
        S3Backend().discard_tmp_copy(str(foreign))
        assert foreign.exists()
