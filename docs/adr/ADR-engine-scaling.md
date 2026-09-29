# ADR: Engine scaling (design only — STOP before merging a session change)

Status: proposed. Date: 2026-09-29.

## Measured present state

- 1 uvicorn worker (`engine/Dockerfile`), server worker concurrency 1
  (`WORKER_CONCURRENCY`, 512MB free-tier ceiling).
- Sessions are process memory (`engine/sessions.py`): max 10, TTL 2h, with
  eviction. Scan/analyze progress slots and angle uploads live and die with
  the process.
- Per-analysis throughput/cost NOT measured here: no sample-video + Gemini
  runs were made in this session (would spend real API budget and quota).
  Measure before committing to instance counts: time `/scan` + `/analyze`
  for 1/3/5-minute 720p clips, record Gemini input/output tokens and
  CPU-seconds, derive cost per analysis minute.

## Why 2+ instances do not work today

1. A scan on instance A is invisible to analyze on instance B (session dict).
2. Scan-progress SSE slots are per-process.
3. In-flight jobs die with the instance (job state is Redis, but the video
   bytes and session files are local disk).

## Session-store direction (implement behind a flag only)

Derive the session from durable state instead of process memory: the storage
key namespace (`raw/<session>/<angle>/`) already names everything an analyze
needs — re-resolve `session_token → keys` by listing the prefix at analyze
time (both backends support it), and persist scan-progress snapshots to the
existing job record rather than the progress dict. Do NOT use the
quota-limited Redis for this. Consequences: analyze becomes retryable on any
instance; upload affinity disappears; listing prefixes costs one storage
round trip per analyze (measure it).

## Explicit non-goals

No GPU/K8s until measured throughput demands it. No change to the single
uvicorn worker until the ADR numbers exist. No session-store code merges
without review — STOP here.
