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

### Phase 1 — Evidence model (§19–§21, §25–§26) — SHIPPED (core)
1. `findings` table: per-analysis rows keyed `(server_job_id, id)`, scoped
   to accounts via the `analysis_history` join (no duplicated `auth0_id`).
2. Engine `core/findings.py` derives one finding per scored event (stable
   `{job}:e{n}` ids, ms timestamps, confidence bands, severity, evidence
   frames, model versions); low-evidence → `needs_review`, never a strong
   claim. Persisted once on completion (idempotent replace).
3. Web `FindingsTimeline` with click-to-seek in chat (desktop + mobile),
   read-only in results; chat prompts cite finding ids + timestamps (§25).
4. `GET /api/auth/user/:auth0Id/findings/trends` — per-day counts by
   category with needs-review split (§26 precursor).
Open: review actions (approve/flag), finding→training-objective link,
per-player trend views (deferred to Phase 2 teams).

### Phase 2 — Org hardening (§3, §4, §7, §29, §5) — SHIPPED (core)
1. `teams` + `team_memberships` tables; `students.team_id` with cross-org
   validation; team filter on student list; teams client in `web-next/lib`.
2. `permissions.ts`: 14-permission vocabulary layered over roles
   (owner full; admin all but `medical.read`; scoped coach; analyst;
   medical; read-only player) + `canAccessTeam` scope; teams routes enforce
   membership → permission → scope; analyst admitted to auth/user reads.
   Roles extended to analyst/medical (server + web + contract tests).
3. Token invites (`invites.ts`): random 256-bit, hashed storage, 7-day TTL,
   single-use, revocable; mint/list/revoke (owner/admin) + self accept
   (`/api/me/invites/accept`); uniform invalid/expired errors.
4. `audit_logs` (best-effort writer): membership invite/role/remove,
   invite revoke/accept, team CRUD + membership changes; owner/admin read.
5. Medical boundary: `injury_risk` stripped from status/auth-detail/player
   summaries unless the caller is the owning account or holds the medical
   role (owner includes accountability); `maySeeMedical`/`redactWellness`
   tested.
Open: teams UI (assignment/filter screens), finding review actions still
Phase 1-open, per-player finding trends.

### Phase 3 — Pipeline durability (§11–§18, §30) — SHIPPED (core)
1. Stage resume (`_committed_summary`): retries reuse a committed summary
   (skip Gemini, re-track for fresh landmarks); a surviving render
   completes directly. Committed-artifact short-circuit, tested helpers.
2. Priority tilt: player-hub jobs enqueue at priority 1 over anonymous 0
   (BullMQ); per-org quotas remain open (need org resolution at enqueue).
3. Supabase completion truth strengthened: worker + poll double-persist
   plus persisted-fallback reads (existing); cancelled rows are terminal —
   late completions can't resurrect them.
4. User-visible control: job-level `needs_review` flag + badge; cancel
   (in-progress) and delete (history/findings/chat propagation, audited)
   wired end to end in the dashboard.
Open: per-org quotas/aging (§17), retention policy config (§30), backup
restore testing (§31) — Phase 4 items.

### Phase 4 — Storage & workers (§8–§10, §31, §34) — SHIPPED (core)
1. Bucket layout on local disk (`storage.raw_upload_key` /
   `result_key`): immutable `raw/{session}/{angle}/{uuid}.mp4` sources,
   one `results/{job}.mp4` per analysis — maps 1:1 to future buckets.
2. Server-side media inspection: ffprobe duration/dimensions/codec check
   in scan (rejects corrupt/mislabeled uploads early); Dockerfiles already
   non-root; compose pins `no-new-privileges`, pids/mem ceilings.
3. Retention: `RETENTION_DAYS` (default 365) daily prune of analyses +
   findings + chat; backup/restore runbook in `docs/BACKUP_RESTORE.md`
   (Supabase PITR, quarterly restore test, explicit gaps).
Open: signed-URL direct uploads + versioned buckets (needs object
storage); per-org quotas/aging (§17); K8s/GPU (not until workload).

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
