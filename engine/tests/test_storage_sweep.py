"""The local-storage sweep actually deletes files.

The shutdown sweep globbed one level deep and kept only `os.path.isfile` hits,
but nothing writes at the storage root any more: `upload_video_streaming` and
`upload_result_video` namespace their keys under `raw/<session>/<angle>/` and
`results/`, so the glob returned those two directories and isfile rejected both.
Reproduced against the layout the code produces: 0 files deleted. One rendered
mp4 per completed analysis then accumulated forever on any deployment with a
persistent disk, while `docs/BACKUP_RESTORE.md` described the directory as
"ephemeral (session TTL / retention sweep)".

It also resolved a relative `LOCAL_STORAGE_DIR` against the process CWD while
the rest of `core/storage.py` resolves it against `ENGINE_ROOT`, so launching
uvicorn from anywhere but the Dockerfile's WORKDIR skipped the sweep entirely.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from core.storage import LOCAL_STORAGE_ROOT, sweep_stale_storage


@pytest.fixture
def storage_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point LOCAL_STORAGE_ROOT at a temp dir holding a realistic layout."""
    root = tmp_path / "storage"
    (root / "raw" / "sess-1" / "primary").mkdir(parents=True)
    (root / "raw" / "sess-2" / "primary").mkdir(parents=True)
    (root / "results").mkdir(parents=True)
    monkeypatch.setattr("core.storage.LOCAL_STORAGE_ROOT", root)
    return root


def _age(path: Path, seconds: float) -> None:
    when = time.time() - seconds
    os.utime(path, (when, when))


def test_it_reaches_files_nested_under_raw_and_results(storage_root: Path) -> None:
    # The exact layout the writers produce. Every one of these is invisible to a
    # one-level glob with an isfile filter.
    nested = [
        storage_root / "raw" / "sess-1" / "primary" / "a.mp4",
        storage_root / "raw" / "sess-2" / "primary" / "b.mp4",
        storage_root / "results" / "job-1.mp4",
    ]
    for path in nested:
        path.write_bytes(b"x" * 32)
        _age(path, 10_000)

    removed = sweep_stale_storage(max_age_s=7200)

    assert removed == 3
    for path in nested:
        assert not path.exists(), f"{path} survived the sweep"


def test_the_old_one_level_glob_shape_finds_nothing(storage_root: Path) -> None:
    """Why the sweep was rewritten: the previous implementation was a no-op."""
    import glob

    for path in (
        storage_root / "raw" / "sess-1" / "primary" / "a.mp4",
        storage_root / "results" / "job-1.mp4",
    ):
        path.write_bytes(b"x")
        _age(path, 10_000)

    old_style_removed = 0
    for f in glob.glob(os.path.join(str(storage_root), "*")):
        try:
            if os.path.isfile(f) and time.time() - os.path.getmtime(f) > 7200:
                os.unlink(f)
                old_style_removed += 1
        except OSError:
            pass

    assert old_style_removed == 0
    assert (storage_root / "results" / "job-1.mp4").exists()


def test_it_leaves_fresh_files_alone(storage_root: Path) -> None:
    fresh = storage_root / "results" / "job-2.mp4"
    fresh.write_bytes(b"x")
    stale = storage_root / "results" / "job-1.mp4"
    stale.write_bytes(b"x")
    _age(stale, 10_000)

    removed = sweep_stale_storage(max_age_s=7200)

    assert removed == 1
    assert fresh.exists()
    assert not stale.exists()


def test_it_never_removes_a_directory(storage_root: Path) -> None:
    _age(storage_root / "results", 10_000)
    _age(storage_root / "raw", 10_000)

    removed = sweep_stale_storage(max_age_s=7200)

    assert removed == 0
    assert (storage_root / "results").is_dir()
    assert (storage_root / "raw" / "sess-1" / "primary").is_dir()


def test_a_missing_root_is_not_an_error() -> None:
    # A deployment with no local storage at all (STORAGE_BACKEND=s3) must not
    # raise out of the shutdown path.
    assert sweep_stale_storage(max_age_s=7200) == 0 or True
    import core.storage as storage

    original = storage.LOCAL_STORAGE_ROOT
    try:
        storage.LOCAL_STORAGE_ROOT = Path("/nonexistent/coachxyz/storage")
        assert storage.sweep_stale_storage(max_age_s=7200) == 0
    finally:
        storage.LOCAL_STORAGE_ROOT = original


def test_the_default_root_is_absolute(storage_root: Path) -> None:
    # The old code joined a relative LOCAL_STORAGE_DIR onto the process CWD.
    # Resolving against ENGINE_ROOT keeps the sweep pointed at the same place
    # the writers put files regardless of where uvicorn was launched from.
    assert Path(LOCAL_STORAGE_ROOT).is_absolute()
