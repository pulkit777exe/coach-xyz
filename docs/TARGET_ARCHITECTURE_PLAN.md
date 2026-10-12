# Target Architecture Adoption Plan

Target: `Targeted Secure Architecture v2` (organization-first sports intelligence,
evidence-traceable AI). This plan maps that doc onto the current codebase and
sequences the work so every phase ships independently with baselines green.

Baselines (must stay green every phase; verified green 2026-10-11): server `bun test` 354 · web `vitest`
180 · engine pytest 207 · `tsc --noEmit` both · eslint both · `next build`.

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

> Snapshot as of 2026-10-11. Rows marked SHIPPED point to the phase below
> that delivered them; remaining gaps are explicit.

| §      | Requirement                                                                                 | Status                                                                                                                                                                                                                                  | Evidence                                                   |
| ------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 3, 28  | Org-owned `organization_id` on every row; teams/seasons/matches                             | **Shipped in Phase 2** — `teams` + `team_memberships` exist, seasons/matches shipped; per-row `organization_id` FK discipline still open | `historyStore.ts`, `orgMembers.ts`           |
| 4      | Permission + scope (not just roles)                                                         | **Shipped in Phase 2** — `permissions.ts` (14 permissions over 8 org roles) + team/student scope; analyst/medical roles admitted | `permissions.ts`, `serviceGuard.ts` (`verifyOrgRole`, `orgRoleGuard`) |
| 19–21  | Finding objects w/ evidence frames, confidence, severity, model versions; human-review gate | **Shipped in Phase 1** — `findings` table + `core/findings.py` (stable ids, evidence gate) + approve/flag review + trends | `findings.py`, `findings.ts`, `FindingsTimeline.tsx` |
| 22     | Model registry per analysis                                                                 | **Partial** — `model` string + engine/prompt/sport-pack `provenance` stamped on every summary; no central registry | `analysis_history.model`, `config.py`, `analyzer.py` `_stamp_provenance` |
| 23     | Prompt-injection separation (system vs untrusted content)                                   | **Shipped in Phase 0** — `UNTRUSTED-USER-CONTENT` / `ORG-DATA` delimiters + guard rules + tests | `prompt_guard.py`, `chat_prompt.py`, `prompt.py` |
| 8, 10  | Signed-URL upload intents; storage buckets raw/normalized/frames/clips                      | **Shipped in Phase 4 (core)** — intent-first uploads (`/upload-intent` → presigned S3 or multipart local → `/scan-from-key`), dual backend, bucket-shaped `raw/…` + `results/…` layout; versioned buckets still open | `scan.ts`, `storage.py`, `main.py` |
| 9      | Hardened media workers (non-root, no shell strings, limits)                                 | **Shipped in Phase 4 (core)** — ffmpeg via structured args, ffprobe inspection at scan, non-root Docker users, compose `no-new-privileges` + cpu/mem/pid ceilings | `video_io.py`, `Dockerfile`s, `docker-compose.prod.yml` |
| 16, 17 | Durable workflow; Redis not source of truth; fair per-org queueing                          | **Shipped in Phase 3 (core)** — stage resume, Supabase completion truth (worker + poll double-persist), terminal cancels, daily per-org cap + tier priority; per-org aging still open | `queue.ts`, `analyses.ts`, `jobs.py` |
| 29     | Audit logs                                                                                  | **Shipped in Phase 2** — `audit_logs` table + best-effort `auditRoute()` writer, owner/admin reads | `audit.ts`, `historyStore.ts` |
| 7      | Single-use hashed invite tokens                                                             | **Shipped in Phase 2** — random 256-bit hashed tokens, 7-day TTL, single-use, revocable, self-accept | `invites.ts`, `routes/members.ts`, `/invite` |
| 5      | Health/wellness boundary                                                                    | **Shipped in Phase 2** — `injury_risk` stripped unless the caller is the owning account or holds the medical role | `injury_risk.py`, `permissions.ts` (`maySeeMedical`/`redactWellness`) |
| 24–26  | Permission-aware AI retrieval; longitudinal finding trends                                  | **Partial** — chat cites finding ids + timestamps; per-day finding trends shipped; trends derive from findings, retrieval still single-analysis | `chat.ts`, `chat_prompt.py`, `findings.ts` trends |
| 32     | OpenTelemetry traces, correlation chain                                                     | **Partial** — correlation `job_id` logging exists; no traces/metrics                                                                                                                                                                    | `logging_config.py`, `instrument.ts`                       |
| 30–31  | Retention lifecycle + deletion propagation; tested restores                                 | **Shipped in Phase 4 (core)** — session-owned uploads, `RETENTION_DAYS` daily prune, delete propagation, backup runbook; restore testing is procedural (quarterly) | `main.py` `_delete_session_files`, `storage.py`, `docs/BACKUP_RESTORE.md` |

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
   Open: per-org quota aging beyond the daily cap (§17); K8s/GPU
   (explicitly out of scope). The measurement loop itself is closed:
   objectives carry completion state, profiles render weekly findings-vs-done,
   and players see their objectives in the hub.
   The wider sweep is also shipped: seasons, matches, training plans, wellness
   check-ins (medical-gated reads), subscriptions/usage ledger with
   tier-weighted queue priority, internal stage history, video/report/settings
   audit actions, no-diagnosis AI rules, deep dict-form criteria in all six
   sport packs (pack v2, basketball still v1), stages debug endpoint.

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
   Hierarchy (§3: owner → coaches/medical → players): `resolveStudentScope`
   gives owners/admins the full roster and staff only their teams' students
   (list + detail-404, cross-team assignment blocked, single-team coaches
   auto-assign on create).
   Management UI (9ui): members page (staff + token invites with one-shot
   links), teams page (CRUD, membership, per-team finding trends), audit page
   (action filter), student team assignment + filter + column, `/invite`
   accept flow, finding approve/flag in chat, needs-review badge, working
   cancel/delete, per-org daily analysis quota (`ORG_DAILY_ANALYSIS_LIMIT`).
   Open: finding→training-objective link, student-profile trend views.

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
   findings + clips + player_events + chat; backup/restore runbook in `docs/BACKUP_RESTORE.md`
   (Supabase PITR, quarterly restore test, explicit gaps).
   Uploads (§8) run intent-first: validated metadata mints a namespaced key
   (`POST /upload-intent`), browsers upload direct-to-storage (presigned POST
   on S3, multipart proxy on local), bytes re-probed at scan
   (`POST /scan-from-key`); backends switch via `STORAGE_BACKEND`, and the
   on-disk layout (`raw/…` + `results/…`) maps 1:1 to future versioned buckets.
   Open: versioned buckets (§10); per-org quotas/aging (§17); K8s/GPU (not
   until workload).

### Post-Phase 4 — Roles, clips, evidence, quality, registry — SHIPPED

1. Coaching tracks: `head_coach` (full coach) + `assistant_coach`
   (scoped: no team/player/member management); `coach` kept as a legacy
   alias. Guards, `AUTH_USER_ALLOWED_MEMBER_ROLES`, single-team
   auto-assign, and the web mirror admit both; nav gating hides Members
   (owner/admin/head_coach/coach) and Audit (owner/admin) by role.
2. Clips: `clips` table (label + `[start_ms, end_ms)`, optional finding
   link, 120s/100-per-analysis caps) + list/create/delete API
   (`finding.review`-gated, audited, rate-limited); 9ui `ClipsSection`
   with click-to-seek in the analysis room; delete/prune cascades cover
   clips + player_events.
3. Evidence + quality: engine `enforce_evidence_gate` (strong bands
   without frames, inverted/out-of-duration ranges → `needs_review`)
   plus server persist-time re-gate; pre-render `_stage_quality_check`
   stamps `summary.quality` and forces review without blocking.
4. Registry + vocab: `organizations`/`videos`/`player_events` tables and
   `lib/registry.ts`; per-sport `positions` in all six packs served via
   engine → guard-exempt server proxy → roster Select (free-text fallback).
5. Findings CSV export (BOM, stable columns, formula guard) + Export
   button; `AUDIT_ACTIONS` single list mirrored by the audit filter;
   `escapeHtml` coerces Dates; shared `globalErrorHandler` on app + smoke.
6. Docs: Auth0 tenant checklist (`docs/AUTH0_TENANT_CHECKLIST.md`).

## Suggested order

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4. Rationale: 0 is
zero-migration groundwork; 1 delivers the product thesis (evidence a coach
can click) on the current schema; 2 locks the security boundary before scale;
3–4 are infra-heavy and only pay off once 1–2 create real load.

## Out of scope (explicit)

- Microservice split (§2: stay modular monolith + separate workers).
- Kubernetes (§34: not until workload demands).
- Multi-sport depth (§27: all six packs now carry dict-form `form_criteria`
  with ideal/acceptable ranges; per-sport tuning depth still varies).
- Clinical/medical workflows (§5: report language only, no diagnosis).
