# In-memory limiter eviction is O(n log n) per request when oversized

Status: wontfix

Triaged 2026-10-01: bounded, outage-only, single-instance; revisit if the fallback ever goes multi-instance.

## What

`server/src/lib/ratelimit.ts` `memoryLimit` sorts the whole bucket map on
every call once over `MEMORY_LIMIT_MAX_ENTRIES`. Reachable only during a
Redis outage — exactly when the server is also under stress, so a spam
burst then amplifies into per-request full-map sorts.

## Fix options

- Probabilistic expiry (check a random bucket per call) instead of
  full-sort eviction.
- Accept: single-instance free-tier path, bounded map, outage-only.
  Downgrade to wontfix with this rationale if agreed.

## Context

Survey suspicion S4 (code confirmed, impact debated), 2026-09-30.
