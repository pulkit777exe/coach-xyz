# Sports Performance Intelligence Platform — Current Codebase Map

Large god-modules and the org route monolith were split (see report
`/tmp/opencode/architecture-review-1758613600.html`, candidates 1–6, all
shipped). This file records where the remaining domain modules live so new
code lands in the right place.

## Server (`server/src/`)

| Domain                    | Routes                                                                                                                                | Data layer                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Identity boundary         | `lib/serviceGuard.ts`, `lib/attribution.ts`, `lib/jobAccess.ts`, `lib/httpErrors.ts` (shared error handler: app + smoke)              | —                                                                                       |
| Caller + permissions      | `lib/caller.ts` (`resolveCaller`), `lib/permissions.ts`                                                                               | `lib/orgMembers.ts` (roles), `lib/teams.ts`                                             |
| History/analyses          | `routes/status.ts`, `routes/analyze.ts`, `routes/download.ts`                                                                         | `lib/analyses.ts`, `lib/jobs.ts`, `lib/queue.ts`, `lib/engine.ts`                       |
| Findings                  | `routes/auth.ts` (trends/list/review/stages/export)                                                                                   | `lib/findings.ts` (persist gate, CSV)                                                   |
| Clips                     | `routes/auth.ts` (list/create/delete)                                                                                                 | `lib/clips.ts` (validator + scoped CRUD)                                                |
| Registry                  | `routes/scan.ts`, `routes/auth.ts` (sync)                                                                                             | `lib/registry.ts` (organizations, videos, player_events)                                |
| Users                     | `routes/auth.ts` (sync), `routes/me.ts`                                                                                               | `lib/users.ts`                                                                          |
| Chat                      | `routes/chat.ts`, `routes/auth.ts` (history)                                                                                          | `lib/chatMessages.ts`, `lib/conversation.ts`                                            |
| Org subdomains            | `routes/org/` (students, attendance, schedule, reports, objectives, billing, compete, plans, wellness, performance, overview, shared) | `lib/orgData.ts`                                                                        |
| Members/invites/audit     | `routes/members.ts`, `routes/teams.ts`                                                                                                | `lib/orgMembers.ts`, `lib/invites.ts`, `lib/audit.ts` (`AUDIT_ACTIONS`), `lib/teams.ts` |
| Player hub                | `routes/me.ts`                                                                                                                        | `lib/orgData.ts` (scoped reads)                                                         |
| Sport vocab               | `routes/sports.ts` (guard-exempt, cached, degrades to [])                                                                             | engine sport packs via `GET /sports/{sport}/positions`                                  |
| Email/share/notifications | `routes/email.ts`, `routes/share.ts`, `routes/notifications.ts`, `routes/aiReports.ts`                                                | `lib/mailer.ts`, `lib/shareTokens.ts`, `lib/notifications.ts`, `lib/aiReportData.ts`    |
| Schema + connection       | —                                                                                                                                     | `lib/historyStore.ts` (all DDL, 3 parallel levels)                                      |

## Engine (`engine/`)

| Stage                                    | Module                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Routes/SSE/sessions/multicam/sport-vocab | `main.py` (incl. `GET /sports/{sport}/positions`)                                                                                         |
| Orchestrator + explicit stages           | `core/analyzer.py` (`AnalysisContext`, prepare/resume/tracking/reasoning/scoring/render)                                                  |
| Detection/tracking/pose                  | `core/detector.py`, `core/tracking.py`, `core/pose_backend.py`, `core/detection_utils.py`                                                 |
| Gemini + prompts + guards                | `core/gemini_client.py`, `core/prompt.py`, `core/chat_prompt.py`, `core/report_prompt.py`, `core/prompt_guard.py`                         |
| Findings/validator/stats/quality         | `core/findings.py` (evidence gate), `core/quality.py` (pre-render check), `core/validator.py`, `core/stats.py`, `core/injury_risk.py`     |
| Media/storage/sports                     | `core/video_io.py` (ffmpeg+ffprobe), `core/storage.py` (local/S3), `core/sport_config.py` (`sport_positions()` + loader), `sports/*.json` |
| Jobs/cache/dedup                         | `core/jobs.py`, `core/cache.py`, `core/dedup.py`                                                                                          |

## Web (`web-next/`)

| Area              | Entry                                                                                                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline (coach)  | `lib/usePipeline.ts` over `lib/useScanFlow.ts` (scan seam)                                                                                                                                                                                                                                               |
| Pipeline (player) | `components/player/PlayerHub.tsx` over `lib/useScanFlow.ts`                                                                                                                                                                                                                                              |
| Management pages  | `app/dashboard/{students,teams,members,audit,reports,schedule,attendance,history,settings}` + `components/org/*` (9ui; `PreferencesSection`, position vocab Select, Monday-first calendar; home is role-differentiated: full / staff / personal player view; objectives have a List/Board kanban toggle) |
| Analysis views    | `components/{AppClient,AnalysisDetailClient,ResultsSummary,VideoPlayer,FindingsTimeline,ChatLayout,ClipsSection,...}`                                                                                                                                                                                    |
| Clients           | `lib/api.ts`, `lib/org.ts`, `lib/teams.ts`, `lib/members.ts`, `lib/meApi.ts`, `lib/sports.ts` (positions), `lib/serviceProxy.ts` (proxy allowlist), `lib/preferences.tsx` (theme/week-start/motion)                                                                                                      |
| Notifications     | `components/notifications/NotificationBell.tsx` (dashboard sidebar + marketing header)                                                                                                                                                                                                                   |
| Discovery         | `components/SidebarSearch.tsx` (⌘K palette: role-gated pages + player search)                                                                                                                                                                                                                            |
| Nav gating        | `lib/nav.ts` (`MEMBERS_NAV_ROLES`, `AUDIT_NAV_ROLES`, `visibleNavGroups`)                                                                                                                                                                                                                                |
| RSC data          | `lib/serverData.ts` (React.cache)                                                                                                                                                                                                                                                                        |

## Conventions (must keep)

- No barrel imports; direct paths only. No components defined in components.
- Identity: browser-direct capability routes use `x-attribution`; everything
  else transits the `/api/service` proxy with service headers.
- `resolveCaller()` is the only way to derive role/teams/scope in a route.
- Static vocab routes stay guard-exempt end to end (engine → `routes/sports.ts` → `isStaticVocabPath`); extend all three when adding one.
- `auditRoute()` is the only way to write audit entries from a route.
- Every page carries a `PageHeader` trail rooted at Home (detail pages use the record name); the analysis room keeps its interactive title with plain-text crumbs.
- Engine streaming: no gzip; SSE deadlines + heartbeats; timeouts on Gemini.
