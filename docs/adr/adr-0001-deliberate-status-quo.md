# ADR-0001: Deliberate Status Quo (do-not-re-litigate decisions)

Status: Accepted
Date: 2026-09-24 (records decisions reaffirmed by the 2026-09-23 architecture review)

## Context

The 2026-09-23 architecture review surfaced eight "obvious-looking" improvements that were
considered and **rejected** — each has a cost that outweighs the benefit at current scale,
or the duplication itself is the mechanism that keeps three tiers honest. Six architecture
candidates landed 2026-09-24 around them without touching any of these decisions (one
related *defect* — per-caller sprawl of the no-DB policy — was fixed; the policy itself
stands). This ADR records them so future reviews start from "decided", not "unknown".

## Decision

1. **`historyStore` fail-open-to-null policy stands.** `withHistoryStore` returns `null`
   when `DATABASE_URL` is unset or a query fails; callers degrade instead of failing
   requests. The *defect* was the policy's per-caller sprawl (site-by-site `?? default`),
   now fixed via the single `orDisabledDefault(value, fallback)` helper — one place states
   the fallback, the fail-open policy itself is unchanged.
2. **Redis noop client + rate-limit in-memory fallback.** With no Redis env, `lib/redis.ts`
   hands out a noop client and `lib/ratelimit.ts` falls back to an in-memory bucket map.
   The service stays available at degraded fidelity (limits lost on restart) rather than
   refusing to boot — correct for free-tier single-instance deploys.
3. **Engine module-global Redis client.** `engine/core/jobs.py`/`cache.py` build their
   Upstash REST client at module import. Acceptable because the engine is a
   single-process FastAPI app (`--workers 1`); no per-request client construction, no
   DI container. Revisit only if the engine ever runs multi-process.
4. **Three-tier `STATE_FLOW` mirror is a wire contract, not duplication to merge.** The
   pipeline state order is declared once per layer (engine `STATE_FLOW`, server
   `ENGINE_PIPELINE_STATES`, web map) precisely so each layer's types/tests pin the wire:
   contract tests in all three (`test_state_machine.py`, `pipelineContract.test.ts`,
   `pipeline.test.ts`) fail on any rename/removal. Sharing one literal across languages
   would remove the mechanism, not the duplication.
5. **Engine no-GZip middleware.** Deliberate: GZip buffers whole responses, which stalls
   SSE token streams (`/chat/stream`, `/scan-progress`) and gains little on already
   compressed mp4 downloads (`engine/main.py` comment).
6. **`is_local_backend()` branches at the callsite.** Storage behavior (presigned URLs vs
   proxying) differs per response type at each call site; a strategy object would move
   the same conditionals behind an interface without removing them. Restructure only with
   a new ADR that names the concrete win.
7. **`/chat` is stateless with caller-supplied history; in-memory sessions are the
   lifetime boundary.** The engine keeps no conversation state — the server sends
   `conversation_history` each call (via `askEngineChat`), so the engine stays restartable
   and stateless; scan sessions live in a capped, 2h-TTL in-memory dict as an explicit
   lifetime boundary (files die with the session).
8. **Notifications use an in-process `EventEmitter`.** Single-instance deployment (one
   server process) makes an in-process bus correct and free; a durable/bus-based emitter
   only pays off with >1 server instance — a scaling decision, not a correctness one.

## Consequences

- Reviewers should not open PRs "fixing" items 1–8 without a new ADR superseding this one;
  the defects these look like were either fixed differently (item 1) or are the mechanism
  (items 4, 6).
- The genuinely-fixed adjacent defects (2026-09-24 candidates) are recorded in
  `ARCHITECTURE.md` §10 "Resolved (fixed 2026-09-24)" — wrapper-owned DDL init,
  `orDisabledDefault`, `requireVerifiedSelf`/`admitAnalysis`, lazy queue wiring + single
  Redis URL derivation, `Transcript` seam, engine-owned status/retryable registry with
  server posture helpers.
- Scaling triggers: item 3 → multi-process engine; item 8 → multiple server instances;
  item 2 → any deployment where losing rate-limit state on restart is unacceptable.
