"""One SQLite file holds jobs, the event log and scan sessions.

Each thread gets its own connection (WAL mode), so the worker pool, the
webhook dispatcher and request handlers never share one.
"""

import json
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 0,
    params TEXT NOT NULL,
    callback_url TEXT NOT NULL DEFAULT '',
    error TEXT,
    degraded TEXT NOT NULL DEFAULT '[]',
    cancel INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL
);
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    stream TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    ts REAL NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_try REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_stream ON events(stream, seq);
CREATE INDEX IF NOT EXISTS events_pending ON events(delivered, next_try);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    data TEXT NOT NULL
);
"""

_local = threading.local()


def _path() -> str:
    config.settings.data_dir.mkdir(parents=True, exist_ok=True)
    return str(config.settings.data_dir / "engine.db")


def conn() -> sqlite3.Connection:
    pool: dict[str, sqlite3.Connection] = getattr(_local, "pool", None) or {}
    _local.pool = pool
    path = _path()
    c = pool.get(path)
    if c is None:
        c = sqlite3.connect(path, timeout=10, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.executescript(SCHEMA)
        pool[path] = c
    return c


def run(sql: str, args: tuple = ()) -> sqlite3.Cursor:
    return conn().execute(sql, args)


def one(sql: str, args: tuple = ()) -> dict[str, Any] | None:
    row = conn().execute(sql, args).fetchone()
    return dict(row) if row else None


def rows(sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


@contextmanager
def transaction():
    """Make several statements visible to other connections all at once."""
    c = conn()
    c.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        c.execute("ROLLBACK")
        raise
    c.execute("COMMIT")
