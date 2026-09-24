# Sports Performance Intelligence Platform — Current Codebase Map

Large god-modules and the org route monolith were split (candidates 1–6 of an
earlier architecture review, all shipped — the report itself no longer exists
at its original location). This file records where the remaining domain
modules live so new code lands in the right place. Last verified 2026-09-24,
after the server routes/libs split, the engine `main.py` slim-down, and the
2026-09-24 architecture-candidate + routing-sync pass (new seam modules below,
three dead routes removed).

## Server (`server/src/`)

| Domain                    | Routes                                                                                                                                | Data layer                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Identity boundary         | `lib/serviceGuard.ts`, `lib/attribution.ts`, `lib/jobAccess.ts`, `lib/httpErrors.ts` (shared error handler: app + smoke)              | —                                                                                       |
| Caller + permissions      | `lib/caller.ts` (`resolveCaller`, self-scope `requireVerifiedSelf`/`missingVerifiedSelf`), `lib/permissions.ts`                       | `lib/orgMembers.ts` (roles), `lib/teams.ts`                                             |
| History/analyses          | `routes/status.ts`, `routes/analyze.ts`, `routes/download.ts`                                                                         | `lib/analyses.ts`, `lib/jobs.ts`, `lib/queue.ts` (lazy), `lib/engine.ts`, `lib/analysisAdmission.ts` (admission), `lib/retention.ts` (sweep) |
| Findings                  | `routes/findings.ts` (trends/list/export/review)                                                                                      | `lib/findings.ts` (persist gate, CSV)                                                   |
| Clips                     | `routes/clips.ts` (list/create/delete; mounted by `routes/auth.ts`)                                                                   | `lib/clips.ts` (validator + scoped CRUD)                                                |
| Registry                  | `routes/scan.ts`, `routes/auth.ts` (sync)                                                                                             | `lib/registry.ts` (organizations, videos, player_events)                                |
| Users                     | `routes/auth.ts` (sync), `routes/me.ts`                                                                                               | `lib/users.ts`                                                                          |
| Chat                      | `routes/chat.ts` (`/api/chat/stream` only), `routes/chatHistory.ts` (transcript GET/POST + ask-an-analysis; mounted by `routes/auth.ts`) | `lib/transcript.ts` (`Transcript` seam: `playerTranscript` Redis / `dashboardTranscript` Postgres), `lib/sse.ts` (buffered SSE parsing), `lib/chatMessages.ts`, `lib/conversation.ts`, `lib/aiResponse.ts` (connectivity fallback) |
| Org subdomains            | `routes/org/` (students, attendance, schedule, reports, objectives, billing, compete, plans, wellness, performance, overview, shared) | `lib/org/*` per domain, via the `lib/orgData.ts` barrel                                 |
| Members/invites/audit     | `routes/members.ts`, `routes/teams.ts`                                                                                                | `lib/orgMembers.ts`, `lib/invites.ts`, `lib/audit.ts` (`AUDIT_ACTIONS`), `lib/teams.ts` |
| Player hub                | `routes/me.ts`                                                                                                                        | `lib/orgData.ts` (scoped reads)                                                         |
| Sport vocab               | `routes/sports.ts` (guard-exempt, cached, degrades to [])                                                                             | engine sport packs via `GET /sports/{sport}/positions`                                  |
| Email/share/notifications | `routes/email.ts`, `routes/share.ts`, `routes/notifications.ts`, `routes/aiReports.ts`                                                | `lib/mailer.ts`, `lib/shareTokens.ts`, `lib/notifications.ts`, `lib/aiReportData.ts`    |
| Schema + connection       | —                                                                                                                                     | `lib/historyStore.ts` (all DDL, 3 parallel levels — sole owner; no-DB fallbacks via `orDisabledDefault`) |

Routes removed 2026-09-24 (dead): `GET …/analyses/:jobId/stages` (+ orphaned
`getAnalysisStages`/`AnalysisStageEntry`), server `POST /api/chat`
(non-streaming — web only used `/api/chat/stream`; the engine keeps `POST /chat`),
and `GET /api/org/:auth0Id/teams/:teamId` (+ dead web `getTeam`).
`GET /health/deep` stays (ops-only; frontend only pings `/health`).
New contract tests the same day: `server/tests/{historyStore,identityGuards,
analysisAdmission,queue,redisUrl,sse,transcript,chatHistoryEngine}.test.ts`
plus `server/tests/errors.test.ts` (32) for status/retryable parity.

## Engine (`engine/`)

| Stage                                    | Module                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Routes/SSE               | `api/` (`scan.py`, `analyze.py`, `chat.py`, `report.py`, `jobs.py`, `health.py`, `sports.py`, `errors.py`), mounted by the thin `main.py` |
| Sessions + cleanup       | `sessions.py` (2h-TTL session tokens, `delete_session_files`)                                                                             |
| Multicam                 | `core/multicam.py`                                                                                                                        |
| Sport vocab              | `core/sport_config.py` (vocab SSOT; served by `api/sports.py` → `GET /sports/{sport}/positions`)                                          |
| Orchestrator + explicit stages           | `core/analyzer.py` (`AnalysisContext`, prepare/resume/tracking/reasoning/scoring/render)                                                  |
| Detection/tracking/pose                  | `core/detector.py`, `core/tracking.py`, `core/pose_backend.py`, `core/detection_utils.py`                                                 |
| Gemini + prompts + guards                | `core/gemini_client.py`, `core/prompt.py`, `core/chat_prompt.py`, `core/report_prompt.py`, `core/prompt_guard.py`                         |
| Findings/validator/stats/quality         | `core/findings.py` (evidence gate), `core/quality.py` (pre-render check), `core/validator.py`, `core/stats.py`, `core/injury_risk.py`     |
| Media/storage/sports                     | `core/video_io.py` (ffmpeg+ffprobe), `core/storage.py` (local/S3), `core/sport_config.py` (`sport_positions()` + loader), `sports/*.json` |
| Jobs/cache/dedup                         | `core/jobs.py`, `core/cache.py`, `core/dedup.py`                                                                                          |
| Error/status registry                    | `core/errors.py` (`STATUS_BY_CODE` + `RETRYABLE_BY_CODE` — engine owns code → status/retryable), rendered by `api/errors.py` (`error_response`/`error_retryable`) |
| New contract tests (2026-09-24)          | `tests/test_api_errors.py` (registry/wire parity), `tests/test_chat_route.py` (`/chat` core fields; ignores dead `system_prompt`)        |
| Chat/report engine clients              | `core/chat_client.py`, `core/report_client.py`                                                                                             |
| CLI session tooling                     | `cli/` (`main.py`, `analyze_session.py`, `frame_selector.py`, `chunker.py`, `gemini.py`, `player_detector.py`)                            |

## Web (`web-next/`)

| Area              | Entry                                                                                                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline (coach)  | `lib/usePipeline.ts` over `lib/useScanFlow.ts` (scan seam)                                                                                                                                                                                                                                               |
| Pipeline (player) | `components/player/PlayerHub.tsx` over `lib/useScanFlow.ts`                                                                                                                                                                                                                                              |
| Management pages  | `app/dashboard/{students,teams,members,audit,reports,schedule,attendance,history,settings}` + `components/org/*` (9ui; `PreferencesSection`, position vocab Select, Monday-first calendar; home is role-differentiated: owner (org health + plan + staff preview) / coach-staff (teams + org ops) / player (`PlayerHub` rendered at `/dashboard`); objectives have a List/Board kanban toggle) |
| Analysis views    | `components/{AppClient,AnalysisDetailClient,ResultsSummary,VideoPlayer,FindingsTimeline,ChatLayout,ClipsSection,...}`                                                                                                                                                                                    |
| Clients           | `lib/api.ts`, `lib/org.ts`, `lib/teams.ts`, `lib/members.ts`, `lib/meApi.ts`, `lib/sports.ts` (positions), `lib/serviceProxy.ts` (proxy allowlist), `lib/preferences.tsx` (theme/week-start/motion)                                                                                                      |
| Notifications     | `components/notifications/NotificationBell.tsx` (dashboard sidebar + marketing header)                                                                                                                                                                                                                   |
| Discovery         | `components/SidebarSearch.tsx` (⌘K palette: role-gated pages + player search)                                                                                                                                                                                                                            |
| Nav gating        | `lib/nav.ts` (`MEMBERS_NAV_ROLES`, `AUDIT_NAV_ROLES`, `HISTORY_NAV_ROLES`, `ALL_NON_PLAYER_ROLES`, `visibleNavGroups`) + `lib/permissions.ts` (role→permission mirror) + `components/AccessDenied.tsx` (page floor view)                                                                                                                                     |
| RSC data          | `lib/serverData.ts` (React.cache)                                                                                                                                                                                                                                                                        |

## Role matrix & UI gating (frontend)

`web-next/lib/permissions.ts` mirrors `server/src/lib/permissions.ts` — same
vocabulary and role→permission matrix, pinned by
`web-next/lib/__tests__/permissions.test.ts` (single-sided edits break CI).
Three literal guard floors are additionally pinned from where the server
mounts them: `REPORT_SEND_ROLES` (email family, `server/src/index.ts`),
`TEAM_DELETE_ROLES` (`server/src/routes/teams.ts`),
`MEMBER_INVITE_ROLES` (`server/src/routes/members.ts`). Gating layers, all
UX-only — the server remains the enforcement point:

- **Nav**: `lib/nav.ts` role lists filter `DashboardNav`, `SidebarSearch`, and
  the Features page.
- **Pages**: `/dashboard/{members,audit,history}` render
  `components/AccessDenied.tsx` before any fetch when the role is out of floor.
- **Data**: the dashboard home skips the org-analyses fetch for `medical`
  (granted `medical.read`, not `analysis.read`).
- **Capabilities**: pages compute `canManage`/`canInvite`/`canWrite`/`canSend`/
  `canDeleteTeam` from `lib/permissions.ts` and thread them into the
  Students/Teams/Reports/Invites clients and StudentProfile (→ objectives,
  plans, wellness — matching the server's `player.manage` writes).
- **Player**: `/player/reports/[id]` reads only `/api/me/reports/:id`
  (self-scoped + row-checked server-side); hub rows link there.

| Permission         | owner | admin | head_coach | assistant_coach | coach | analyst | medical | player |
| ------------------ | :---: | :---: | :--------: | :-------------: | :---: | :-----: | :-----: | :----: |
| `org.invite`       |  ✓    |  ✓    |            |                 |       |         |         |        |
| `org.manage_members`|  ✓   |  ✓    |            |                 |       |         |         |        |
| `team.create`      |  ✓    |  ✓    |            |                 |       |         |         |        |
| `team.manage`      |  ✓    |  ✓    |     ✓      |                 |  ✓    |         |         |        |
| `team.manage_members`|  ✓  |  ✓    |     ✓      |                 |  ✓    |         |         |        |
| `team.read`        |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |    ✓    |        |
| `analysis.create`  |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |         |        |
| `analysis.read`    |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |         |   ✓    |
| `player.read`      |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |    ✓    |        |
| `player.manage`    |  ✓    |  ✓    |     ✓      |                 |  ✓    |         |         |        |
| `report.read`      |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |    ✓    |   ✓    |
| `report.create`    |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |         |        |
| `finding.review`   |  ✓    |  ✓    |     ✓      |       ✓         |  ✓    |    ✓    |         |        |
| `medical.read`     |  ✓    |       |            |                 |       |         |    ✓    |        |

**Server gaps (frontend-only for now — server fixes out of scope here):**

- **Regression (broken since `b9fca0f`, 2026-09-22 — FIXED, worktree):**
  `serviceGuard` passed the ABSOLUTE `request.url` into
  `resolveMemberRoleForPath` → `isOrgScopedPath` did `startsWith('/api/org/')`,
  which never matches — `memberRole` was always `null` and every caller whose
  sub ≠ the org id got **403 `FORBIDDEN` "Authenticated identity does not
  match the requested account"** on all `/api/org|email|auth/user/:id/*` routes
  (member-persona data pages either `.catch`-degraded to empty or hit the RSC
  error boundary). Fix: `isOrgScopedPath` normalizes its input
  (`new URL(x).pathname`, raw string on parse failure) so absolute URLs and
  bare pathnames both match the org prefixes — +6 hermetic regression tests in
  `server/tests/serviceGuard.test.ts` pin the normalization and the
  absolute-URL member fast path (`bun test` 348 pass / 0 fail / 34 files;
  member `/reports`, `/students`, `/teams` verified 200). Shares files with
  the concurrent winston-logging migration, so it commits with that server work.
- `/api/org/:id/reports` CRUD runs on identity + the app-level non-player floor
  only (guard now fixed): `medical` can
  create/update/delete reports server-side despite `report.read`-only (UI hides
  the affordances).
- `attendance`/`schedule`/`performance`/`overview`/`students` writes have no
  per-role floor beyond membership: any non-player member (incl. `medical`,
  `analyst`) can invoke them over raw HTTP where the matrix grants read-only.
- The email floor (`owner, admin, head_coach, assistant_coach, coach`) is
  *stricter* than `report.create`: `analyst` can draft reports but not email
  them — mirrored on both sides, recorded here so the asymmetry is conscious.
- Enforced server-side today: `objectives`/`plans` (`player.manage`),
  `compete` (`team.manage`), `teams` (+ owner/admin delete floor),
  `members` (`orgRoleGuard` per scope), `wellness` (read `medical.read`,
  write `player.manage`), `aiReports` (email-family floor).

**Intentional server behavior the UI mirrors (verified 2026-09-24):**

- `/api/auth/user/:id/*` cross-account reads floor to
  `AUTH_USER_ALLOWED_MEMBER_ROLES` (`server/src/lib/serviceGuard.ts`:
  owner/admin/head_coach/assistant_coach/coach/analyst) — `medical` and
  `player` are excluded by design (analyses carry full `summary_json`). The
  dashboard landing skips its stats + analyses fetches outside that floor
  (pinned as `AUTH_USER_ALLOWED_MEMBER_ROLES` in `lib/permissions.ts`, tested),
  so medical renders with zero stat tiles and no Recents section instead of a
  single 403 nulling the whole Promise.all (the "Failed to load dashboard
  data" banner medical used to show).
- Org student lists scope to the caller's team hierarchy (`studentScope`):
  members with no assigned team see `[]` even when the org has students — a
  scoped empty list, not a failed fetch.

## Conventions (must keep)

- Design foundations — type scale, 9ui/interior.dev library policy, motion
  tokens, role-IA + states contract: `docs/DESIGN_FOUNDATIONS.md`.
- No barrel imports; direct paths only. No components defined in components.
- Identity: browser-direct capability routes use `x-attribution`; everything
  else transits the `/api/service` proxy with service headers.
- `resolveCaller()` is the only way to derive role/teams/scope in a route.
- Static vocab routes stay guard-exempt end to end (engine → `routes/sports.ts` → `isStaticVocabPath`); extend all three when adding one.
- `auditRoute()` is the only way to write audit entries from a route.
- All DDL lives in `historyStore.ensureInitialized()`; org row uniqueness is
  org-scoped — keep `ON CONFLICT` targets in `lib/org/*` in sync.
- 429s come from `rateLimited()` (`lib/ratelimit.ts`); ids validate against
  `UUID_RE` (`lib/uuid.ts`).
- Every page carries a `PageHeader` trail rooted at Home (detail pages use the record name); the analysis room keeps its interactive title with plain-text crumbs.
- Engine streaming: no gzip; SSE deadlines + heartbeats; timeouts on Gemini.
