# Target Architecture Adoption Plan

Target: `Targeted Secure Architecture v2` (organization-first sports intelligence,
evidence-traceable AI). This plan maps that doc onto the current codebase and
sequences the work so every phase ships independently with baselines green.

Baselines (must stay green every phase): server `bun test` 192 · web `vitest`
138 · engine pytest 147 · `tsc --noEmit` both · eslint both · `next build`.

## Where we already align

- Control/analysis split exists: `web-next` + `server` (Bun/Elysia) + `engine`
  (FastAPI) — §1 planes, single-deployable modular shape (§2).
- Identity boundary: Auth0 → Next proxy injects `x-service-token` +
  `x-verified-auth0-id`; `serviceGuard.ts` enforces; browser-direct routes use
  signed `x-attribution` (`jobAccess.ts` owner binding). Part of §6/§33.
- Shipped fixes (commits `0317677`, `65faf44`):
  - Cross-account `/api/auth/user/*` grants restricted to coach+ roles;
    players use self-scoped `/api/me/*` (§4 precursor, §33).
  - Jobs bound to owner subs at enqueue; status/chat/conversation/download
    require a matching signed sub on owned jobs (header or `?attribution=`
    for headerless video/download consumers); anonymous demo jobs stay
    bearer-readable (§6, §33).
  - Per-sub rate limits on scan/analyze/chat/download; scan-progress SSE
    capped (§33 abuse Harrington).
  - SSE hardening: no gzip buffering, async chat pump, comment heartbeats,
    100s conversational / 10-min analysis Gemini deadlines (§14 timeouts).
  - Multi-perspective sessions: per-angle scans, per-angle progress slots,
    angle-stamped results + sport `camera_angles` guidance (§27 packs).
  - Scan↔track player-index contract tested; out-of-range raises (§20
    evidence correctness).
  - Session-owned upload lifecycle: files deleted on session eviction,
    re-upload orphans cleaned (§30 precursor).
- Evidence-flavored outputs: shot events carry timestamps, biomechanics,
  per-criterion scoring rationale; chat cites `timestamp_refs`; rendered video
  has HUD + summary screen. Precursor to §19–§21, not yet Findings.
- Idempotency precursors: video-hash cache + dedup keys, BullMQ retries with
  `UnrecoverableError`, per-job Redis locks. Part of §18.
- Structured JSON logs + Sentry on all three layers. Precursor to §32.

## Gap map (doc § → status → evidence)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 3, 28 | Org-owned `organization_id` on every row; teams/seasons/matches | **Missing** — tables are `users, org_members, students, attendance, schedule_events, reports, performance_metrics, video_conversations, analysis_history, chat_messages, notifications`; no `teams`, no `organization_id` FK discipline | `supabaseHistory.ts:179-440`, `orgMembers.ts:58` |
| 4 | Permission + scope (not just roles) | **Missing** — roles only (`owner/admin/coach/player`) | `serviceGuard.ts` (`verifyOrgRole`, `orgRoleGuard`) |
| 19–21 | Finding objects w/ evidence frames, confidence, severity, model versions; human-review gate | **Missing** — `shot_events` have timestamps/scores but no finding id, severity, evidence frame refs, or review state | `gemini_client.py:normalize_gemini_result`, `validator.py` |
| 22 | Model registry per analysis | **Partial** — `model` string persisted; no detector/tracker/prompt/sport-pack versions | `analysis_history.model`, `analyzer.py` |
| 23 | Prompt-injection separation (system vs untrusted content) | **Missing** — chat concatenates raw user message into one prompt | `chat_prompt.py`, `prompt.py` |
| 8, 10 | Signed-URL upload intents; storage buckets raw/normalized/frames/clips | **Missing** — multipart through server (buffered), engine local disk (`LOCAL_STORAGE_DIR`), uuid keys, no buckets | `scan.ts`, `engine.ts:scanVideo`, `storage.py` |
| 9 | Hardened media workers (non-root, no shell strings, limits) | **Partial** — ffmpeg via structured args (`video_io.py`); no container policy in repo, no media validation beyond mime/size | `video_io.py:28-71`, `Dockerfile` |
| 16, 17 | Durable workflow; Redis not source of truth; fair per-org queueing | **Missing** — BullMQ + Redis job state is the truth; concurrency 1; no quotas/priority | `queue.ts`, `jobs.py` |
| 29 | Audit logs | **Missing** — no audit table or writer | grep: no `audit_log` in `server/src` |
| 7 | Single-use hashed invite tokens | **Missing** — invites are emails with a signup link; no token table | `email.ts:28`, `orgMembers.inviteOrgMember` |
| 5 | Health/wellness boundary | **Missing** — `injury_risk` rides inside the normal summary, no extra permission | `injury_risk.py`, `analyzer.py` |
| 24–26 | Permission-aware AI retrieval; longitudinal finding trends | **Missing** — chat gets one analysis summary; trends derived from scores, not findings | `chat.ts`, `chat_prompt.py` |
| 32 | OpenTelemetry traces, correlation chain | **Partial** — correlation `job_id` logging exists; no traces/metrics | `logging_config.py`, `instrument.ts` |
| 30–31 | Retention lifecycle + deletion propagation; tested restores | **Partial** — session-owned uploads with eviction deletion + shutdown sweep; no retention policy, no backup verification | `main.py` `_delete_session_files`, `storage.py` |

## Phased plan

### Phase 0 — Foundations (no schema changes) — SHIPPED
1. ~~Error vocabulary freeze~~ — already frozen + tested (`test_errors.py`
   pins `STATUS_BY_CODE`, retryability, fallbacks).
2. Prompt-structure separation (`core/prompt_guard.py`): athlete turns and
   org data wrapped in UNTRUSTED/ORG-DATA delimiters with data-only rules;
   guard tests (`test_prompt_guard.py`, `test_chat_prompt.py`).
3. Version stamping: `ENGINE_VERSION` / prompt versions in `config.py`,
   `"version": 1` in all six sport packs, `sport_pack_version()` loader,
   `provenance` stamped on every summary and carried on the TS wire types.
4. `X-Request-Id` web→server→engine (generated per call, forwarded through
   the queue worker by job id, echoed + logged by the engine).

### Phase 1 — Evidence model (§19–§21, §25–§26)
1. New `findings` table: `id, analysis_id, auth0_id, category, player ref,
   start/end ms, confidence band, severity, observation, evidence frames,
   model_versions, review_state (auto/approved/flagged), created_at`.
2. Engine emits findings alongside `shot_events` (derive from events +
   biomechanics + sport criteria; low-evidence → `needs_review`, never a
   strong claim).
3. Server persists + serves findings per analysis (owner-scoped like
   summaries); web renders finding timeline with click-to-seek timestamps;
   chat answers cite finding ids + timestamps (§25).
4. Trend queries aggregate findings per player over time (§26), replacing
   score-only trends.

### Phase 2 — Org hardening (§3, §4, §7, §29, §5)
1. `teams` + `team_memberships` tables; scope students/analyses by team.
2. Permission+scope check (`analysis.create @ team:X`) layered over roles;
   players keep self-scope; add `analyst` and optional `medical` roles.
3. Invite tokens table: random, hashed, single-use, expiring (§7).
4. `audit_logs` writer on membership/permission/share/export/delete (§29).
5. Move `injury_risk`/wellness behind the `medical` permission; AI never
   states diagnoses (§5).

### Phase 3 — Pipeline durability (§11–§18, §30)
1. Stage-level idempotency keys (`analysis_id, stage, input_hash,
   model_version`) with committed-artifact short-circuit (§18).
2. Per-org concurrency + quota + priority with aging (§17); Redis stays
   cache/realtime, Supabase becomes the completion source of truth (§16).
3. User-visible state labels mapped from internal states (§12); orchestrator
   owns retries/timeouts/cancellation explicitly (§14).
4. Retention policy + deletion propagation across artifacts (§30).

### Phase 4 — Storage & workers (§8–§10, §31, §34)
1. Upload intents + signed multipart URLs direct to object storage (§8);
   server validates mime/size/duration server-side post-upload.
2. Bucket layout `raw/normalized/frames/clips/annotations/reports/exports`
   with `organization/analysis/artifact/version` keys (§10).
3. Worker container policy (non-root, RO fs, CPU/mem/disk/pids limits, no
   shell strings — already structured) documented + enforced in Docker (§9).
4. Backup/restore runbook with tested restore (§31).

## Suggested order

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4. Rationale: 0 is
zero-migration groundwork; 1 delivers the product thesis (evidence a coach
can click) on the current schema; 2 locks the security boundary before scale;
3–4 are infra-heavy and only pay off once 1–2 create real load.

## Out of scope (explicit)

- Microservice split (§2: stay modular monolith + separate workers).
- Kubernetes (§34: not until workload demands).
- Multi-sport depth (§27: one sport deeply first — recommend basketball,
  the only pack with dict-form `form_criteria`).
- Clinical/medical workflows (§5: report language only, no diagnosis).
