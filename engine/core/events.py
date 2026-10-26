"""Everything the engine does is announced as an event on a stream.

A stream is a job id or `scan:<session>:<angle>`. Events are appended to the
database, so the server can follow them live over SSE, replay them after a
reconnect, or receive them as signed webhooks (at-least-once, in order per job).
"""

import asyncio
import hashlib
import hmac
import json
import logging
import threading
import time
from collections.abc import AsyncIterator

import httpx

from . import config, db

log = logging.getLogger("engine.events")

TERMINAL = {"job.completed", "job.failed", "job.cancelled", "scan.completed", "scan.failed"}
MAX_DELIVERY_ATTEMPTS = 12


def emit(stream: str, type: str, data: dict | None = None, *, webhook: bool = True) -> int:
    cur = db.run(
        "INSERT INTO events(stream, type, data, ts, delivered) VALUES (?,?,?,?,?)",
        (stream, type, db.dumps(data or {}), time.time(), 0 if webhook else 1),
    )
    return cur.lastrowid


def read(stream: str, after: int = 0, limit: int = 200) -> list[dict]:
    found = db.rows(
        "SELECT seq, type, data, ts FROM events WHERE stream=? AND seq>? ORDER BY seq LIMIT ?",
        (stream, after, limit),
    )
    for e in found:
        e["data"] = json.loads(e["data"])
    return found


def frame(e: dict) -> str:
    return f"id: {e['seq']}\nevent: {e['type']}\ndata: {json.dumps(e['data'])}\n\n"


async def follow(stream: str, after: int = 0, disconnected=None, poll: float = 0.25,
                 heartbeat: float = 15, idle_timeout: float | None = None, finished=None) -> AsyncIterator[str]:
    """Yield SSE frames until a terminal event, the client leaves, `finished()` says the stream is over,
    or nothing happens for `idle_timeout`."""
    last_sent = last_event = time.monotonic()
    while True:
        batch = read(stream, after)
        for e in batch:
            after = e["seq"]
            yield frame(e)
            last_sent = last_event = time.monotonic()
            if e["type"] in TERMINAL:
                return
        if not batch and finished is not None and finished():
            return
        if idle_timeout and time.monotonic() - last_event > idle_timeout:
            return
        if disconnected is not None and await disconnected():
            return
        if time.monotonic() - last_sent > heartbeat:
            yield ": ping\n\n"
            last_sent = time.monotonic()
        await asyncio.sleep(poll)


def sign(body: bytes, timestamp: str) -> str:
    key = config.settings.service_token.encode()
    return "sha256=" + hmac.new(key, timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


class Dispatcher(threading.Thread):
    """Pushes events of jobs that registered a callback URL."""

    def __init__(self, interval: float = 1.0):
        super().__init__(daemon=True, name="webhooks")
        self.interval = interval
        self.stop_flag = threading.Event()
        self.client = httpx.Client(timeout=10)

    def run(self) -> None:
        while not self.stop_flag.wait(self.interval):
            try:
                self.tick()
            except Exception:
                log.exception("webhook tick failed")

    def tick(self) -> int:
        now = time.time()
        pending = db.rows(
            """SELECT e.seq, e.stream, e.type, e.data, e.ts, e.attempts, j.callback_url
               FROM events e JOIN jobs j ON j.id = e.stream
               WHERE e.delivered = 0 AND j.callback_url != '' AND e.next_try <= ?
               ORDER BY e.seq LIMIT 50""",
            (now,),
        )
        blocked: set[str] = set()
        sent = 0
        for e in pending:
            if e["stream"] in blocked:
                continue
            if self.deliver(e):
                db.run("UPDATE events SET delivered=1 WHERE seq=?", (e["seq"],))
                sent += 1
                continue
            attempts = e["attempts"] + 1
            gave_up = attempts >= MAX_DELIVERY_ATTEMPTS
            db.run(
                "UPDATE events SET attempts=?, next_try=?, delivered=? WHERE seq=?",
                (attempts, now + min(300, 2 ** attempts), 2 if gave_up else 0, e["seq"]),
            )
            blocked.add(e["stream"])
        return sent

    def deliver(self, e: dict) -> bool:
        body = json.dumps(
            {"job_id": e["stream"], "seq": e["seq"], "type": e["type"], "ts": e["ts"], "data": json.loads(e["data"])}
        ).encode()
        stamp = str(int(time.time()))
        headers = {"content-type": "application/json", "x-engine-timestamp": stamp,
                   "x-engine-signature": sign(body, stamp)}
        try:
            return self.client.post(e["callback_url"], content=body, headers=headers).status_code < 300
        except httpx.HTTPError as exc:
            log.warning("webhook to %s failed: %s", e["callback_url"], exc)
            return False

    def stop(self) -> None:
        self.stop_flag.set()
        self.client.close()
