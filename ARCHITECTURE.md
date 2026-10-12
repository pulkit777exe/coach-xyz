# Coach-XYZ Architecture

## 1. Overview

Coach-XYZ is a sports video analysis platform that uses Google Gemini AI to analyze athlete technique. Users upload sports videos (basketball, football, cricket, tennis, baseball, hockey), the system detects players, sends frames to Gemini for biomechanical analysis, and returns an annotated video with performance feedback. The system is designed for zero-cost deployment on free-tier infrastructure.

---

## 2. Tech Stack

### Frontend (`web-next/`)
| Technology | Version | Source |
|------------|---------|--------|
| Next.js | ^16.3.5 | `web-next/package.json:20` |
| React | ^19.3.0 | `web-next/package.json:22` |
| Tailwind CSS | ^4.3.3 | `web-next/package.json:35` |
| GSAP | ^3.15.0 | `web-next/package.json:18` |
| TypeScript | ^5.9.3 | `web-next/package.json:35` (dev) |
| @auth0/nextjs-auth0 | ^4.29.0 | `web-next/package.json:13` |
| @sentry/nextjs | ^10.74.0 | `web-next/package.json:16` |
| recharts | ^3.10.1 | `web-next/package.json:24` (lazy chunk only) |

### Server (`server/`)
| Technology | Version | Source |
|------------|---------|--------|
| Bun | (runtime) | `server/Dockerfile:1` — `oven/bun:1` |
| Elysia | ^1.4.30 | `server/package.json:19` |
| BullMQ | ^5.81.5 | `server/package.json:18` |
| ioredis | ^5.11.1 | `server/package.json:20` (only Redis lib) |
| @sentry/node | ^10.74.0 | `server/package.json:17` |
| TypeScript | ^5.9.3 | `server/package.json:25` |

### Engine (`engine/`)
| Technology | Version | Source |
|------------|---------|--------|
| Python | 3.12-slim (Docker; 3.11+ local) | `engine/Dockerfile:6`, `engine/.python-version` |
| FastAPI | 0.141.1 | `engine/requirements.txt:1` |
| uvicorn | 0.54.0 | `engine/requirements.txt:2` |
| google-genai | 2.25.0 | `engine/requirements.txt:4` |
| httpx | 0.28.1 | `engine/requirements.txt:5` |
| mediapipe | 1.0.1 | `engine/requirements.txt:6` |
| opencv-contrib-python | 5.0.0.93 | `engine/requirements.txt:10` |
| orjson | 3.12.0 | `engine/requirements.txt:16` |
| sentry-sdk | 2.70.0 | `engine/requirements.txt:21` |
| upstash-redis | 1.8.0 | `engine/requirements.txt:22` |
| boto3 | >=1.34.0 (S3 path only, lazy) | `engine/requirements.txt:3` |

### Infrastructure
| Component | Technology | Source |
|-----------|------------|--------|
| Queue | BullMQ + Redis (ioredis TCP) | `server/src/lib/queue.ts:1` |
| Job Storage | Upstash Redis (REST) | `engine/core/jobs.py:14-17` |
| Server Redis | ioredis client derived from Upstash REST URL+token | `server/src/lib/redis.ts:6-48` |
| Database | Supabase PostgreSQL (DDL in code) | `server/src/lib/historyStore.ts:11` |
| Video Storage | Local disk (default) or S3-compatible | `engine/core/storage.py:46-52` |
| Deployment | Render (free tier) | `render.yaml` |
| Frontend Hosting | Vercel | `web-next/vercel.json` |

---

## 3. High-Level Architecture / Codemap

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONFIRMED ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Frontend   │───▶│    Server    │───▶│    Engine    │                  │
│  │  (Next.js)   │    │  (Elysia +   │    │  (FastAPI +  │                  │
│  │  Port 3000   │    │   BullMQ)    │    │  MediaPipe)  │                  │
│  └──────────────┘    │  Port 8000   │    │  Port 8001   │                  │
│                      └──────┬───────┘    └──────┬───────┘                  │
│                             │                   │                           │
│                             ▼                   ▼                           │
│                      ┌──────────────┐    ┌──────────────┐                  │
│                      │    Redis     │    │    Local     │                  │
│                      │  (Upstash)   │    │   Storage    │                  │
│                      └──────────────┘    │  /app/tmp/   │                  │
│                             │            └──────────────┘                  │
│                             ▼                   │                           │
│                      ┌──────────────┐           │                           │
│                      │   Supabase   │           │                           │
│                      │  (Postgres)  │           │                           │
│                      └──────────────┘           │                           │
│                                                 ▼                           │
│                                          ┌──────────────┐                  │
│                                          │  Google      │                  │
│                                          │  Gemini API  │                  │
│                                          └──────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory Map

```
coach-xyz/
├── web-next/                  # Frontend (Next.js + React)
│   ├── app/page.tsx           # Home — server shell passing auth0Id to AppClient (pipeline SPA)
│   ├── app/account/page.tsx   # Account / profile page (Auth0 session)
│   ├── app/invite/page.tsx     # Token-invite accept (Suspense → AcceptInviteClient)
│   ├── app/share/[token]/page.tsx  # Public shared-analysis view
│   ├── app/api/service/[[...path]]/route.ts  # Identity proxy (org/auth/email/me/sports)
│   ├── app/player/            # Player Hub (read-only face)
│   │   ├── layout.tsx         # Player shell (session required)
│   │   └── page.tsx           # Role gate (coaches → /dashboard) → PlayerHub
│   ├── app/dashboard/         # Dashboard (session required; players see PlayerHome)
│   │   ├── _shell.ts            # Page shell (session + gate + org + fetchers + fallback)
│   │   ├── layout.tsx         # Sidebar layout with DashboardNav (+ role gate)
│   │   ├── page.tsx           # Role-differentiated home (full / staff / personal)
│   │   ├── students/page.tsx + students/[id]/  # Roster + student profile (objectives, plans, wellness)
│   │   ├── teams/page.tsx / members/page.tsx / audit/page.tsx
│   │   ├── attendance/page.tsx / schedule/page.tsx / settings/page.tsx
│   │   ├── reports/page.tsx + reports/[id]/    # Reports list + detail
│   │   ├── history/page.tsx   # Paginated analysis history
│   │   └── analysis/[id]/     # Analysis detail (+ /chat standalone page)
│   │       ├── page.tsx       # Server component — fetches initialData
│   │       └── chat/page.tsx  # Chat route (see docs/V2_COACH.md)
│   ├── components/            # UI components (all client except AuthHeader)
│   │   ├── AppClient.tsx      # Pipeline state machine (idle→uploading→…→chatting)
│   │   ├── AnalysisDetailClient.tsx  # Detail page polling + findings + clips + chat
│   │   ├── AnalysisProgress.tsx / ResultsSummary.tsx / ErrorScreen.tsx
│   │   ├── LandingPage.tsx / PlayerSelector.tsx (count + angle picker)
│   │   ├── AuthHeader.tsx (server) / HeaderClient.tsx / DashboardNav.tsx
│   │   ├── ChatLayout.tsx / ChatPanel.tsx / ChatMessage.tsx / ChatInput.tsx
│   │   ├── ChatTyping.tsx / HistoryChat.tsx (persisted per-analysis chat)
│   │   ├── VideoPlayer.tsx (seek ref) / FindingsTimeline.tsx (seek + review)
│   │   ├── ClipsSection.tsx (clip CRUD + seek) / QuickActions.tsx
│   │   ├── AnalysisTitle.tsx / TimestampPill.tsx / GlobalSearch.tsx
│   │   ├── SidebarSearch.tsx (⌘K palette) / UserAvatar.tsx / ThemeToggle.tsx
│   │   ├── org/               # Coach dashboard: StudentsClient, TeamsClient,
│   │   │                      #   MembersSection, InvitesClient, AuditClient,
│   │   │                      #   AttendanceGrid, ScheduleClient, ReportsClient,
│   │   │                      #   StudentProfile (objectives kanban + plans +
│   │   │                      #   wellness sections), PerformanceChart (dynamic),
│   │   │                      #   dialogs, PageHeader, OrgSwitcher
│   │   ├── player/PlayerHub.tsx  # Read-only player view (self-scoped /api/me/*)
│   │   ├── notifications/NotificationBell.tsx (SSE bell)
│   │   ├── interior/          # Generic primitives (modal, drawer, popover, …)
│   │   ├── marketing/         # Marketing islands (contact form, …)
│   │   └── 9ui/ui/            # shadcn-style primitives (button, badge, card, …)
│   ├── lib/
│   │   ├── data/              # Deep data core (transport, errors, attribution, query/mutate/stream/upload)
│   │   ├── api.ts             # API client (thin facades over lib/data/* core)
│   │   ├── auth0.ts           # Auth0Client singleton (30s HTTP timeout)
│   │   ├── org.ts / teams.ts / members.ts / meApi.ts / aiReports.ts
│   │   │                      # Org / teams / members / player-hub / AI-report clients
│   │   ├── playerUpload.ts    # Player self upload (POST /api/me/analyze)
│   │   ├── serviceProxy.ts    # Proxy allowlist (identity vs static-vocab paths)
│   │   ├── session.ts         # React.cache wrapper — auth0.getSession (RSC only)
│   │   ├── serverData.ts      # React.cache-wrapped server fetchers (RSC pages)
│   │   ├── analysis.ts        # Pure helpers: analysisScore, getShotEvents
│   │   ├── csv.ts             # CSV serialize/parse (formula-injection-safe)
│   │   ├── date.ts            # ISO date/time conversions
│   │   ├── nav.ts             # MEMBERS/AUDIT_NAV_ROLES + visibleNavGroups
│   │   ├── sports.ts          # Sport emoji + positions helpers
│   │   ├── usePipeline.ts     # Unified pipeline machine (idle→…→chatting→error, both surfaces)
│   │   ├── useScanFlow.ts     # Scan/upload seam (feeds usePipeline)
│   │   ├── jobPolling.ts      # Job-status poll engine (clock/fetch/callbacks)
│   │   ├── pipelineState.ts   # ENGINE_STATE_MAP + mapEngineStateToPipeline
│   │   ├── errors.ts          # Client error normalization + transient check
│   │   ├── sse.ts             # Shared SSE line parser (data: JSON)
│   │   ├── notifications.ts   # Notification fetch/read/subscribe
│   │   ├── preferences.tsx    # LocalStorage prefs (theme/week-start/motion)
│   │   ├── utils.ts           # cn() class-name helper + capitalize
│   │   └── __tests__/         # lib unit tests (18 files, 180 tests)
│   ├── proxy.ts               # Next 16 Auth0 middleware (passthrough)
│   ├── next.config.ts         # Security headers + /api/download rewrite
│   └── types/index.ts         # Shared type definitions
│
├── server/                    # Middleware server (Bun + Elysia)
│   ├── src/index.ts           # Entry point, CORS, security headers, error handler
│   ├── src/routes/
│   │   ├── scan.ts            # POST /api/scan-video|/scan-intent|/scan-from-key + SSE progress
│   │   ├── analyze.ts         # POST /api/analyze-video — thin, via lib/admission.ts
│   │   ├── status.ts          # GET /api/job-status/:jobId + conversation (persist, medical-redact)
│   │   ├── download.ts        # GET /api/download/:jobId — stream (owner-checked)
│   │   ├── chat.ts            # POST /api/chat + /api/chat/stream → engine
│   │   ├── email.ts           # POST /api/email/:auth0Id/{invite|report|attendance} (Resend)
│   │   ├── auth.ts            # /api/auth/* — sync, user, analyses/findings/clips/chat/stages/stats (guarded; jobGuard + chatTurn inside)
│   │   ├── org/               # /api/org/:auth0Id/* — students, attendance, schedule,
│   │   │                      #   reports, objectives, billing, compete (seasons/matches),
│   │   │                      #   plans, wellness, performance, overview (guarded)
│   │   ├── members.ts         # Members + token invites + audit reads
│   │   ├── teams.ts           # Team CRUD + membership
│   │   ├── me.ts              # /api/me/* — player self-scoped hub + attribution mint + analyze (via admission)
│   │   ├── share.ts           # Share-token mint/list/revoke + public GET /api/share/:token
│   │   ├── sports.ts          # Guard-exempt sport-positions proxy (cached, fail-open)
│   │   ├── aiReports.ts       # AI report enqueue + poll (BullMQ coachai-report)
│   │   ├── notifications.ts   # Notifications list/read + SSE stream
│   │   └── health.ts          # GET /health, /health/deep (guard-exempt)
│   ├── src/lib/
│   │   ├── queue.ts           # Compat facade over workerLifecycle (preserved enqueue API)
│   │   ├── workerLifecycle.ts # Lifecycle: retry/persist/events/sweeps/shutdown + job-kind adapters
│   │   ├── redis.ts           # ioredis client derived from Upstash REST URL+token
│   │   ├── jobs.ts            # Server-side job mapping (server_job_id → engine_job_id)
│   │   ├── engine.ts          # HTTP client to engine (timeout-wrapped)
│   │   ├── admission.ts       # Analyze admission (rate→validate→quota→tier→persist→enqueue→usage)
│   │   ├── analyses.ts        # Analysis persistence + org daily quota + retention prune
│   │   ├── findings.ts        # Findings store/query/CSV export/trends
│   │   ├── clips.ts           # Clip bookmarks (validator + scoped CRUD)
│   │   ├── registry.ts        # Organizations / videos / player_events registries
│   │   ├── ratelimit.ts       # 8 buckets (scan/analysis/chat/download/scanprogress/clip/email/aireport)
│   │   ├── attribution.ts     # Mint/verify signed attribution tokens (10-min HMAC)
│   │   ├── serviceGuard.ts    # SERVICE_TOKEN + verified-auth0-id + org-role guards
│   │   ├── jobAccess.ts       # Owner-set vs anonymous job access
│   │   ├── jobGuard.ts        # Ownership + review + failed-mark checks
│   │   ├── caller.ts          # resolveCaller (role/teams/scope) + permissions.ts (14 perms)
│   │   ├── orgEnums.ts        # Shared org vocab (contract w/ web lib/org.ts)
│   │   ├── orgData.ts         # Compat barrel over orgRoster/orgAttendance/orgReports/orgObjectives
│   │   ├── orgRoster.ts / orgAttendance.ts / orgReports.ts / orgObjectives.ts
│   │   │                      # Subdomain data modules + orgStore.ts (shared store helper)
│   │   ├── orgMembers.ts / invites.ts / audit.ts / teams.ts
│   │   │                      # Memberships, single-use token invites, audit log, teams
│   │   ├── userRoles.ts       # coach/player role vocab (contract w/ web)
│   │   ├── users.ts           # User sync/store
│   │   ├── historyStore.ts    # All Postgres DDL (3 parallel levels) + pool
│   │   ├── chatMessages.ts    # Chat message persistence
│   │   ├── chatTurn.ts        # One-turn interactor (context + engine + fallback)
│   │   ├── conversation.ts    # Redis-backed conversation storage
│   │   ├── shareTokens.ts     # Time-limited share tokens
│   │   ├── notifications.ts   # Notification store + SSE
│   │   ├── aiReportData.ts    # AI-report job lifecycle
│   │   ├── mailer.ts          # Resend sender (501 degrade without key)
│   │   ├── requestMeta.ts     # Client IP/UA extraction
│   │   ├── httpErrors.ts      # Shared error handler (app + smoke)
│   │   └── errors.ts          # Error types and builders
│   ├── src/types/index.ts     # Shared API types
│   └── scripts/smokeOrgHttp.ts  # Live HTTP smoke (51 checks)
│
├── engine/                    # Video analysis engine (Python + FastAPI)
│   ├── main.py                # FastAPI app, routes, sessions, multicam, SSE
│   ├── core/
│   │   ├── analyzer.py        # Orchestrator (prepare/resume/tracking/reasoning/scoring/render)
│   │   ├── detector.py / tracking.py / pose_backend.py / detection_utils.py
│   │   │                      # Detection, motion scoring, MediaPipe abstraction, HOG/IoU
│   │   ├── player_detector.py # Legacy OpenCV HOG+SVM path
│   │   ├── player_tracker.py  # Keyframe scoring + box↔skeleton matching (CLI only)
│   │   ├── gemini_client.py   # Active Gemini call + normalize
│   │   ├── gemini.py / gemini_common.py  # Legacy video-file path + shared JSON helpers
│   │   ├── prompt.py / chat_prompt.py / report_prompt.py / prompt_guard.py
│   │   │                      # Analysis/chat/report prompts + injection delimiters
│   │   ├── validator.py       # Gemini output schema validation (6 sports)
│   │   ├── stats.py           # Shot-event stat recount + correction
│   │   ├── findings.py        # Evidence-traceable Finding objects (evidence gate)
│   │   ├── quality.py         # Pre-render non-blocking quality check
│   │   ├── injury_risk.py     # Injury-risk indicator computation (medical-gated downstream)
│   │   ├── jobs.py            # Engine-side job state machine (Redis, 2h TTL)
│   │   ├── cache.py           # Video hash + Redis caching (24h TTL)
│   │   ├── dedup.py           # In-memory request deduplication (300s)
│   │   ├── storage.py         # Local disk or S3 (raw/{session}/{angle} + results/{job})
│   │   ├── video_io.py        # ffprobe + ffmpeg preprocessing + keyframes
│   │   ├── multicam.py        # Multi-angle session helpers (primary + angles)
│   │   ├── sport_config.py    # sports/*.json loader (positions + versions)
│   │   ├── chunker.py         # >240s video chunking (180s + 10s overlap)
│   │   ├── config.py          # ENGINE_VERSION, model, timeouts, sizes
│   │   ├── logging_config.py  # JSON structured logging (job-id correlation)
│   │   └── errors.py          # Error types hierarchy
│   ├── cli/                   # Local CLI (frame_selector, analyze_session)
│   ├── tests/                 # pytest suite (19 files, 207 tests)
│   └── requirements.txt       # Python dependencies
│
├── docker-compose.yml         # Local development (engine + server)
├── docker-compose.prod.yml    # Hardened production compose
├── render.yaml                # Render blueprint (engine starter + server free)
├── .github/workflows/         # CI (tests) + deploy hooks + keepalive cron
└── sports/                    # Sport configs: events, positions, camera_angles,
                               #   form_criteria, stats, scoring (basketball v1, rest v2)
```

---

## 4. Data Model

### Redis Data Structures

**Engine Jobs** (`engine/core/jobs.py:20`)
- Key: `coachai:job:{job_id}`
- TTL: 7200 seconds (2 hours)
- Shape: `JobStatus` dataclass (job_id, state, stage, stage_name, progress, complete, error, error_code, retryable, summary, video_key, video_path, created_at)
- States: uploading → scanning → player_selection → analyzing → rendering → completed (or → failed)

**Error Responses** (`server/src/lib/errors.ts`)
- All error responses conform to the `CoachAIError` shape:
  - `code: string` — machine-readable error code (e.g. `ANALYSIS_FAILED`, `JOB_NOT_FOUND`)
  - `message: string` — human-readable error message
  - `layer: "engine" | "server" | "client"` — where the error originated
  - `retryable: boolean` — whether the client should retry the request
  - `retry_after?: number` — seconds to wait before retrying (optional)
- The `isCoachAIError` type guard validates all five fields

**Server Job Mappings** (`server/src/lib/jobs.ts:3-4`)
- Key: `coachai:srv:{server_job_id}`
- TTL: 7200 seconds (2 hours)
- Shape: `{ server_job_id, engine_job_id, session_token, player_index, model, created_at, owner_ids }`
- `owner_ids` binds the job to its verified owners (analyze-video: the `x-attribution` sub; me/analyze: `[coachAuth0Id, requestedBy]`). Empty = anonymous demo job, bearer-readable. Status/chat/conversation/download require a matching `x-attribution` sub when owners exist (`server/src/lib/jobAccess.ts`).

**Rate Limits** (`server/src/lib/ratelimit.ts:69-110`, Redis-backed with in-memory fallback)
- Key: `rl:scan:{ip}` (TTL 60s) — 10 scans/minute (`SCAN_RATE_LIMIT`)
- Key: `rl:analysis:{ip}` (TTL 3600s) — 5 analyses/hour (`ANALYSIS_RATE_LIMIT`)
- Key: `rl:chat:{ip+identity}` (TTL 3600s) — 30 AI chats/hour (`CHAT_RATE_LIMIT`)
- Key: `rl:download:{ip+identity}` (TTL 3600s) — 60 downloads/hour (`DOWNLOAD_RATE_LIMIT`)
- Key: `rl:scanprogress:{ip}` (TTL 60s) — 30 SSE opens/minute (`SCAN_PROGRESS_RATE_LIMIT`)
- Key: `rl:clip:{ip+identity}` (TTL 3600s) — 60 clip ops/hour (`CLIP_RATE_LIMIT`)
- Key: `rl:email:{orgId}` (TTL 86400s) — 20 emails/day per org (`EMAIL_RATE_LIMIT`)
- Key: `rl:aireport:{orgId}` (TTL 3600s) — 10 AI reports/hour per org (`AI_REPORT_RATE_LIMIT`)
- Scan/analysis/scan-progress buckets key on IP; chat/download/clip use an IP+identity composite; email/AI-report key on the org.

**Video Cache** (`engine/core/cache.py:26-27`)
- Key: `coachai:analysis:{video_hash}:p{player_index|all}`
- TTL: 86400 seconds (24 hours)
- Shape: Full Gemini analysis JSON

**Cache Metadata** (`engine/core/cache.py:87-93`)
- Key: `coachai:analysis:{video_hash}:metadata`
- Shape: `{ video_path, cached_at, access_count }`

### Supabase Tables (CONFIRMED — `server/src/lib/historyStore.ts`, all DDL in code)

Level 1 — pipeline + org core:

**video_conversations**
- Primary key: `session_token`
- Fields: file_name, file_mime_type, file_size_bytes, player_count, players_json, scan_response_json, client_ip, user_agent, source, auth0_id

**analysis_history**
- Primary key: `server_job_id`
- Fields: engine_job_id, session_token, player_index, model, stage, stage_name, progress, complete, video_ready, summary_json, status_json, error_code, error_message, download_count, display_name, auth0_id, student_id, requested_at, completed_at

**findings**
- Unique: `(server_job_id, id)` — one row per scored event, joined to `analysis_history`
- Fields: severity, confidence, evidence frames, needs-review flag, model versions

**clips** / **videos** / **player_events** / **organizations**
- `clips`: label + `[start_ms, end_ms)` (120s / 100-per-analysis caps), optional finding link
- `videos`: `storage_key` UNIQUE, status check
- `organizations`: PK `auth0_id`

**training_objectives** / **training_plans** / **seasons** / **matches** / **wellness_checkins** / **subscriptions** / **usage_records** / **analysis_stages** / **audit_logs**
- Objectives carry completion state; wellness rows are medical-gated at read time; subscriptions key on `org_auth0_id` (tier free/pro/elite)

**users**
- Unique: `auth0_id`
- Fields: auth0_id, email, name, nickname, picture, email_verified, `linked_auth0_ids` (text[]), `role` (text, 'coach' | 'player', default 'coach', CHECK constraint), created_at, updated_at
- Purpose: Auth0 user sync — upserted on every login via `POST /api/auth/sync`. `role` defaults to `coach` (first account is a coach); a player's role is flipped to `player` when their login email auto-links to a student row. `linked_auth0_ids` merges multiple providers on one account.

**students** (org — scoped by owning coach `auth0_id`)
- Fields (in `server/src/lib/orgData.ts`): full_name, email, phone, sport, position, jersey_number, date_of_birth, gender, guardian_name, guardian_phone, notes, status (CHECK: STUDENT_STATUSES), team_id, joined_on, `account_auth0_id` (player login link, indexed), created_at, updated_at
- Purpose: the coach's roster. A player's account is linked to their student row by email on first player login (`account_auth0_id` set, user `role` → 'player').

**org_members** / **teams** / **team_memberships** / **invites**
- `org_members`: role per org (owner/admin/head_coach/assistant_coach/coach/analyst/medical/player); single-use hashed invite tokens (7-day TTL, revocable)

**attendance** / **schedule_events** / **reports** / **performance_metrics** (org)
- All scoped by owning coach `auth0_id`; attendance/performance also reference `student_id`. Player read-only views query these with the coach scope + the linked student. (CHECK constraints pin the shared vocab in `server/src/lib/orgEnums.ts`, mirrored contractually in `web-next/lib/org.ts`.)
- **Uniqueness is org-scoped**: `attendance` has a `UNIQUE (auth0_id, student_id, session_date)` constraint (`attendance_auth0_student_session_unique`) and `performance_metrics` a `UNIQUE (auth0_id, student_id, metric_key, measured_at)` (`performance_auth0_student_metric_unique`) — the legacy `UNIQUE (student_id, …)` keys were auto-dropped/migrated idempotently in `ensureInitialized` (`historyStore.ts`), and the upsert `ON CONFLICT` targets in `orgData.ts` match. This stops one org's rows from colliding with another org's same-id student rows.

**chat_messages**
- Primary key: `id` (UUID)
- Fields: server_job_id, auth0_id, role (user/assistant/system), content, timestamp_refs (jsonb), event_refs (jsonb), created_at
- Purpose: Persistent per-analysis chat history

**notifications** / **share_tokens**
- Notifications feed the SSE bell; share tokens are time-limited public links to an analysis

### In-Memory State

**Engine Sessions** (`engine/main.py`)
- Stored in Python dict with threading lock
- TTL: 2 hours (aligned with job TTL), max 10 sessions
- Multi-perspective: one session accumulates camera angles
  (`core/multicam.py`) — `POST /scan` with `session_token` + `angle` appends
  another upload/detection to the same session; `POST /analyze` takes `angle`
  (defaults to `primary`). Legacy top-level `video_key`/`players` always mirror
  the primary angle, so single-angle clients are unchanged. The analysis result
  is stamped with the analyzed `angle` plus the sport's `recommended_angles`
  guidance (from `sports/*.json` `camera_angles`, loaded via
  `core/sport_config.py` — the single loader shared by analyzer + renderer).
- Source uploads live until their session is evicted (files deleted per angle
  in `_delete_session_files`), so re-analysis (other player, other angle,
  retry) keeps working; re-uploading an angle deletes its orphaned file.
- Scan progress is tracked per angle (`{session_token}:{angle}`) and streamed
  via `GET /scan-progress/{session_token}?angle=…`, so parallel perspectives
  don't share one progress slot.
- Player identity contract: scan assigns 1-based `player_index` left-to-right
  by `x_min`, and tracking resolves the same athlete via
  `select_detection_by_index` (out-of-range raises instead of silently
  analyzing a different player).

---

## 5. Request / Data Flow

### Flow 1: Video Upload + Scan (CONFIRMED)

```
1. Frontend POST /api/scan-video (FormData with video file)
   — or intent-first: POST /api/scan-intent → direct upload → POST /api/scan-from-key
   → web-next/lib/api.ts
   → server/src/routes/scan.ts

2. Server validates (rate limit, ffprobe media inspection, file type, size < 500MB)
   → server/src/routes/scan.ts

3. Server forwards to Engine POST /scan (or /scan-from-key for direct uploads)
   → server/src/lib/engine.ts (60s timeout)

4. Engine streams upload to storage (local disk or S3 raw/{session}/{angle} key)
   → engine/main.py

5. Engine runs player detection (HOG + MediaPipe)
    → engine/core/detector.py

6. Engine creates session (in-memory dict, multicam-aware)
    → engine/main.py

7. Engine warms cache for video hash
    → engine/core/cache.py

8. Server persists to Supabase (historyStore.ts) + returns session_token
    → server/src/routes/scan.ts

9. [Optional] Frontend subscribes to scan progress via SSE
    → GET /api/scan-progress/:sessionToken (server/src/routes/scan.ts, proxies raw SSE)
    → GET /scan-progress/{session_token}?angle=… (engine/main.py, per-angle slots)
```

### Flow 2: Analysis (CONFIRMED)

```
1. Frontend POST /api/analyze-video { session_token, player_index }
   (or signed-in POST /api/me/analyze with roster scope)
   → web-next/lib/api.ts (facade over lib/data/* core)
   → server/src/routes/analyze.ts (thin) → lib/admission.ts

2. Admission runs rate → validate → quota → tier → persist → enqueue → usage
   in one module (signed-in: base priority 10 + tier bump, owners
   [coach, requester]; anonymous: attributed-priority or 0)
    → server/src/lib/admission.ts

2. Server creates server_job_id + engine_job_id
    → server/src/routes/analyze.ts

3. Server saves job mapping to Redis
    → server/src/lib/jobs.ts

4. Server pre-creates engine job in Redis
    → server/src/routes/analyze.ts

5. Server enqueues to BullMQ (coachai-analysis; attempts: 3, exponential backoff)
    → server/src/lib/queue.ts

6. BullMQ worker picks up job (WORKER_CONCURRENCY, default 1)
    → server/src/lib/queue.ts

7. Worker calls Engine POST /analyze (12 min timeout; stuck jobs fail at 13 min)
    → server/src/lib/queue.ts

8. Engine runs analysis synchronously
    → engine/main.py → engine/core/analyzer.py
   a. Download video from storage (local or S3)
   b. Check Redis cache → return if hit
   c. Check deduplication → wait if in-progress
   d. Preprocess video (FFmpeg normalize)
   e. Extract keyframes (every 3s, max 30)
   f. [PARALLEL] Detect players + Compute motion scores
   g. Call Gemini API with best frames (10-min deadline)
   h. Cache result in Redis; derive evidence findings; quality check
   i. Render annotated video
   j. Upload result to storage (results/{job}.mp4)

9. Server reads engine status, double-persists completion to Supabase
   (worker + poll), falls back to persisted rows when Redis expires
    → server/src/routes/status.ts
    → server/src/lib/analyses.ts

10. Findings persist once on completion (idempotent replace); clips,
    share tokens, and notifications hang off the same server_job_id
```

### Flow 3: Download Result (CONFIRMED)

```
1. Frontend GET /api/download/:jobId (via next.config.ts rewrite, ?attribution= token)
   → web-next/lib/api.ts getDownloadUrl
   → server/src/routes/download.ts

2. Server checks job access (owner sub vs anonymous) + looks up engine_job_id
   → server/src/lib/jobAccess.ts + jobs.ts

3. Server streams from Engine GET /download/:jobId
   → server/src/lib/engine.ts (60s timeout)

4. Engine serves file from storage (local FileResponse inline; S3 → 302 presigned)
   → engine/main.py → engine/core/storage.py
```

### Flow 4: Chat with AI Coach (IMPLEMENTED — formerly V2)

Two server paths, both proxying to the engine's Gemini chat:

**Non-streaming** (`POST /api/chat`)
1. Frontend sends `{ job_id, message }`
   → web-next/lib/api.ts `getConversation`/`sendChatMessageStream`
   → server/src/routes/chat.ts:26
2. Server loads conversation history from Redis (`coachai:conv:{server_job_id}`, TTL 2h)
   → server/src/lib/conversation.ts
3. Server POSTs to engine `/chat` (60s timeout)
   → engine/main.py:868 → engine/core/chat_prompt.py (analysis context + history)
4. Persists user + assistant messages to Redis; returns `{ reply, timestamp_refs, event_refs }`

**Streaming (SSE)** (`POST /api/chat/stream`)
1. Frontend POSTs `{ job_id, message }` with `Accept: text/event-stream`
   → web-next/lib/api.ts `sendChatMessageStream` (AsyncGenerator over SSE)
   → server/src/routes/chat.ts:101
2. Server calls engine `POST /chat/stream` (120s timeout), `tee()`s the body
   → engine/main.py:953 (SSE token stream with final `done` event)
3. Client gets the stream; background parser saves the full assistant reply on completion

**Auth-scoped chat** (`/api/auth/user/:auth0Id/analyses/:jobId/chat` — GET/POST, server/src/routes/auth.ts) persists messages to Supabase `chat_messages` and falls back to a keyword-based `generateSimpleResponse` when the engine is down.

### Flow 5: Findings, Clips, Share, Notifications, AI Reports

- **Findings**: engine derives one finding per scored event (`core/findings.py`, stable `{job}:e{n}` ids, evidence frames, severity/confidence; low-evidence → `needs_review`); server re-gates at persist; web `FindingsTimeline` seeks + approves/flags; CSV export + per-day trends.
- **Clips**: coach-scoped subclip bookmarks (`finding.review`-gated, audited, rate-limited) with click-to-seek in the analysis room.
- **Share**: org mints time-limited share tokens; public `GET /api/share/:token` serves the shared analysis (web `/share/[token]`).
- **Notifications**: store + SSE stream to the dashboard/marketing bell.
- **AI Reports**: `POST /api/org/:auth0Id/reports/ai` enqueues a `coachai-report` job (engine `/report` with `report_prompt.py` schema); `GET .../ai/:reportJobId` polls.

---

## 6. Authentication & Authorization

### Auth0 (CONFIRMED — replaces earlier "beta code gate" description)

The system uses Auth0 for user authentication. The beta-code gate described in earlier versions of this document **no longer exists** in the server code.

- **Provider:** `@auth0/nextjs-auth0` v4.29.0 (`web-next/package.json`)
- **Client:** `web-next/lib/auth0.ts` — `Auth0Client` singleton with 30s HTTP timeout
- **Session check:** `getSession()` from `lib/session.ts` (React.cache wrapper over `auth0.getSession`) called in every protected server component; deduplicated within a single request so layout + generateMetadata + page call the JWT verify once
- **Protected routes:** `/dashboard/*`, `/player`, `/account` — redirect to `/auth/login` when session absent
- **User identity:** `session.user.sub` (Auth0 subject claim, e.g. `google-oauth2|123` or `github|456`)
- **User sync:** On account page load, `POST /api/auth/sync` upserts the user into the `users` Supabase table. New accounts default to `role = 'coach'` (first account is a coach); when the login email matches a student row, the account is auto-linked (`students.account_auth0_id` set) and its role flips to `player`.
- **Social providers:** Google and GitHub are configured in the Auth0 tenant dashboard (confirmed by CSP `img-src` allowing `*.googleusercontent.com` and `*.githubusercontent.com` in `web-next/next.config.ts`)
- **Logout:** `/auth/logout` (Auth0 SDK route)
- **`auth0_id` attribution on capability routes:** capability-token routes can't transit the identity proxy (uploads/SSE), so scan/analyze attribution uses a **signed attestation token** instead of a raw client header. The web app fetches `GET /api/me/attribution/mint` (self-scoped, behind serviceGuard) which returns a short-lived HMAC-SHA256 token binding the **verified session sub** (`sub.exp.exp-hmac`, TTL 10 min, keyed by `SERVICE_TOKEN`, `server/src/lib/attribution.ts`). Browser-direct scan (`POST /api/scan-video`), analyze (`POST /api/analyze-video`), status (`GET /api/job-status/:jobId`), chat (`POST /api/chat`, `/api/chat/stream`) and conversation (`GET /api/conversation/:jobId`) send it as `x-attribution`; the server verifies and stores the embedded sub in `video_conversations.auth0_id` / `analysis_history.auth0_id`. Downloads (`<video src>`/`<a href>` cannot carry headers) send the same token as `?attribution=` (`getAuthorizedDownloadUrl`), verified identically. A raw `x-auth0-id` header is never trusted — there is nothing to spoof.

### Identity Boundary (service-to-service, two-faces)

The backend never trusts a client-supplied auth0Id. The Next app is the identity boundary for user-scoped data:

- **Guard** (`server/src/lib/serviceGuard.ts`): an Elysia `onBeforeHandle` plugin applied to `auth.ts`/`org/*`/`members.ts`/`teams.ts`/`email.ts`/`share.ts`/`notifications.ts`/`aiReports.ts`/`me.ts` (plus `verifyOrgRole`/`orgRoleGuard` for org-role gating). When `SERVICE_TOKEN` is set on the server it requires `x-service-token` to match and `x-verified-auth0-id` to equal the path `:auth0Id` (or `body.sub` for `/api/auth/sync`, or be present for self-scoped `/api/me/*`; cross-account `/api/auth/user/*` reads additionally require an active coach+ org membership resolved server-side). Returns 403 otherwise. When `SERVICE_TOKEN` is unset the guard is inert (local dev back-compat) and logs a one-time warning.
- **Proxy** (`web-next/app/api/service/[[...path]]/route.ts`): same-origin handler for an allowlist only — `api/auth/sync`, `api/org/:auth0Id/...`, `api/email/:auth0Id/...`, `api/auth/user/:auth0Id/...`, self-scoped `api/me/*`, and the static-vocab `api/sports/:sport/positions` (`lib/serviceProxy.ts`). Reads the Auth0 session (401 otherwise), rejects a verified sub that doesn't match the path resource owner, then injects `x-service-token` + `x-verified-auth0-id` before forwarding.
- **Client routing** (`web-next/lib/api.ts` `IDENTITY_BASE`, `web-next/lib/org.ts`, `web-next/lib/serverData.ts`): client components call the proxy via `lib/api`/`lib/org`; RSC pages call React.cache'd fetchers in `lib/serverData.ts` (which use `lib/api` internally with service headers when called server-side). Middleware (`proxy.ts`, Auth0 passthrough) and route handlers keep using raw `auth0`/`lib/api`.
- **Out of scope of the proxy:** capability-token routes (`/api/scan-video`, `/api/scan-intent`, `/api/scan-from-key`, `/api/scan-progress/:sessionToken`, `/api/analyze-video`, `/api/job-status/:jobId`, `/api/download/:jobId` (via rewrite), `/api/chat`, `/api/chat/stream`, `/api/conversation/:jobId`) stay browser→server so video uploads and SSE streams never transit Vercel. Downloads use a next.config rewrite. These routes never trust a raw `auth0_id` — attribution comes from the signed `x-attribution` token minted at `/api/me/attribution/mint` (see §6 Auth0).

### Roles (account + org)

- **Account vocabulary:** `server/src/lib/userRoles.ts` ↔ `web-next/lib/userRoles.ts` (`['coach','player']`); values/order pinned by the `userRolesContract` tests on both sides.
- **Org roles:** owner/admin/head_coach/assistant_coach/coach/analyst/medical/player (`org_members.ts`); `permissions.ts` layers a 14-permission vocabulary over them (owner full; admin all but `medical.read`; scoped coach tracks; analyst read/create; medical team/player/report + medical.read; read-only player) with team scope (`canAccessTeam`) and student scope (owners/admins see the full roster; staff see only their teams' students).
- **Enforcement server-side:** `users.role` CHECK `('coach','player')`; sync logic flips to `player` on email-linked first login; org routes sit behind `orgRoleGuard`; wellness (`injury_risk`) is stripped unless the caller is the owning account or holds the medical role.
- **Enforcement client-side:** `app/dashboard/layout.tsx` redirects `role === 'player'` → `/player` (dashboard home renders `PlayerHome` for org-role players); `app/player/page.tsx` redirects coaches → `/dashboard`; `lib/nav.ts` hides Members (owner/admin/head_coach/coach) and Audit (owner/admin). Pure enforcement lives in the server guard; the UI gates are UX layer only.

### Player (read-only Hub) Routes (CONFIRMED — `server/src/routes/me.ts`)

Self-scoped — identity is the verified `x-verified-auth0-id` header, never a caller-supplied id.

| Endpoint | Purpose |
|---|---|
| `GET /api/me/profile` | Own user record + linked student + coach auth0_id |
| `GET /api/me/orgs` | Orgs the caller belongs to (invite accept target) |
| `POST /api/me/analyze` | Player self upload (roster scope via admission: base priority 10) |
| `GET /api/me/analyses` | Analyses linked to player's student row |
| `GET /api/me/attendance` | Own attendance records + summary |
| `GET /api/me/schedule` | Team schedule (owning coach's org) |
| `GET /api/me/performance` | Own performance trend (analysis + manual points) |
| `GET /api/me/objectives` | Own training objectives |
| `GET /api/me/reports` | Reports mentioning the player |
| `GET /api/me/reports/:id` | Single report (must belong to the linked student) |
| `GET /api/me/invites/accept` | Accept a single-use invite token |
| `GET /api/me/notifications*` | Notifications list + SSE stream |
| `GET /api/me/attribution/mint` | Short-lived signed attribution token (HMAC over verified sub + expiry, `SERVICE_TOKEN` keyed) for browser-direct scan/analyze routes |

All resolve the linked student via `students.account_auth0_id` and scope queries by the owning coach's `auth0_id` + `student_id`. UI: `app/player/*` (server shell + role gate) + `components/player/PlayerHub.tsx` (client fetch via `web-next/lib/meApi.ts`).

### Auth Routes (CONFIRMED — `server/src/routes/auth.ts`)

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/sync` | Upsert Auth0 user into `users` table |
| `GET /api/auth/user/:auth0Id` | Fetch user record |
| `GET /api/auth/user/:auth0Id/analyses` | Paginated analysis history for user |
| `GET /api/auth/user/:auth0Id/analyses/:jobId` | Single analysis detail |
| `PATCH /api/auth/user/:auth0Id/analyses/:jobId` | Rename analysis (display_name) |
| `POST /api/auth/user/:auth0Id/analyses/:jobId/cancel` | Cancel in-progress job |
| `DELETE /api/auth/user/:auth0Id/analyses/:jobId` | Delete analysis (+ findings/chat propagation, audited) |
| `GET /api/auth/user/:auth0Id/stats` | Aggregate stats (total, completed, failed, downloads) |
| `GET /api/auth/user/:auth0Id/findings/trends` | Per-day finding counts by category (needs-review split) |
| `PATCH /api/auth/user/:auth0Id/findings/:findingId` | Approve/flag a finding (review gate) |
| `GET /api/auth/user/:auth0Id/analyses/:jobId/clips` (+ POST/DELETE) | Clip bookmarks |
| `GET /api/auth/user/:auth0Id/analyses/:jobId/stages` | Internal stage history |
| `GET /api/auth/user/:auth0Id/analyses/:jobId/chat` | Load chat history for analysis |
| `POST /api/auth/user/:auth0Id/analyses/:jobId/chat` | Send chat message, get AI reply |

### Session Tokens (CONFIRMED)

- **Generation:** `engine/main.py` — UUID4 on scan
- **Storage:** In-memory dict (`engine/main.py`) with threading lock
- **TTL:** 2 hours (`SESSION_TTL`, aligned with job TTL), max 10 sessions, 5-min eviction loop
- **Validation:** `engine/main.py` — checks session exists and has video_key

### CORS (CONFIRMED)

- **Server:** `server/src/index.ts:52-55` — allows `FRONTEND_URL` origin
- **Engine:** `engine/main.py:99-105` — allows `SERVER_URL` origin

---

## 7. External Dependencies & Integrations

### Google Gemini API (CONFIRMED)

- **Client:** `engine/core/gemini_client.py` — `google-genai` SDK
- **Key env:** `GEMINI_API_KEY` (required — engine startup fails without it)
- **Model:** `gemini-2.5-flash` (default via `GEMINI_MODEL`, `engine/core/config.py`; mirrored as `DEFAULT_MODEL` in `server/src/types/index.ts` and sent by the frontend in `web-next/lib/api.ts`)
- **Usage:** Video analysis with structured JSON output (validated by `core/validator.py`, normalized by `normalize_gemini_result`)
- **Timeouts:** analysis worker call 12 min (`server/src/lib/queue.ts`); engine-side Gemini analysis deadline 10 min (`GEMINI_ANALYSIS_TIMEOUT_S`, retryable `GEMINI_TIMEOUT`); conversational calls 100s (`CHAT_GEMINI_TIMEOUT_S`), with SSE comment heartbeats on `/chat/stream` during token gaps. Prompts carry `UNTRUSTED-USER-CONTENT` / `ORG-DATA` delimiters (`core/prompt_guard.py`); every summary is stamped with engine/prompt/sport-pack provenance.

### Upstash Redis (CONFIRMED)

- **Engine:** `engine/core/jobs.py:14-17` — REST client (`upstash-redis` Python)
- **Server:** `server/src/lib/redis.ts:6-48` — ioredis-only; derives a `rediss://` URL from `UPSTASH_REDIS_REST_URL` + `_TOKEN` (or `UPSTASH_REDIS_IOREDIS_URL` / local URL)
- **Queue:** `server/src/lib/queue.ts` — TCP connection (`ioredis`) for BullMQ (two queues: `coachai-analysis` + `coachai-report`)
- **Env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_IOREDIS_URL` (local override)

### Supabase PostgreSQL (CONFIRMED)

- **Client:** `server/src/lib/historyStore.ts` — Bun's `SQL` client (max 5, idle 300s)
- **Env var:** `DATABASE_URL`
- **Tables:** all DDL lives in code (`historyStore.ts`, 3 parallel levels + idempotent migrations) — see §4
- **Status:** Optional — graceful degradation if not configured

### Storage (CONFIRMED)

- **Backends:** `engine/core/storage.py` — `local` (default, `LOCAL_STORAGE_DIR`) or `s3` (`STORAGE_BACKEND=s3`, boto3 lazily imported)
- **Layout:** immutable `raw/{session}/{angle}/{uuid}.mp4` sources + one `results/{job}.mp4` per analysis — maps 1:1 to future buckets
- **Direct uploads:** `POST /upload-intent` mints a slot (local → multipart via `/scan`, S3 → presigned POST); `POST /scan-from-key` scans after upload (strict `raw/…` key check)

### FFmpeg (CONFIRMED)

- **Usage:** Video preprocessing (`engine/core/analyzer.py:42-72`), compression (`engine/core/compress.py:26-38`)
- **Installed in:** `engine/Dockerfile:12` — `apt-get install ffmpeg`

### MediaPipe (CONFIRMED)

- **Usage:** Pose detection (`engine/core/pose_backend.py`), player detection (`engine/core/detector.py`)
- **Two backends:** `mediapipe.tasks.python.vision.PoseLandmarker` (preferred) or `mp.solutions.pose` (fallback)
- **Config:** `model_complexity=0`, `num_poses=4` (memory optimization)

---

## 8. Infrastructure & Deployment

### Docker (CONFIRMED)

**Engine** (`engine/Dockerfile`):
- Base: `python:3.12-slim`
- Exposes: 8001
- Worker: Single uvicorn worker (`--workers 1`)
- User: non-root `coachai` (uid 10001)
- Health check: HTTP `/health` every 30s, 60s start period

**Server** (`server/Dockerfile`):
- Base: `oven/bun:1`
- Exposes: 8000
- Health check: HTTP `/health` every 30s, 15s start period

**Compose** (`docker-compose.yml` dev / `docker-compose.prod.yml` hardened):
- Engine + Server with health check dependency; prod adds read-only roots, tmpfs, `cap_drop: ALL`, cpu/mem/pid ceilings, json-file log rotation
- Shared volume: `engine_tmp` for video storage

### Render Deployment (CONFIRMED — `render.yaml`)

- Engine: Starter plan web service, Dockerfile build from GitHub repo (`runtime: docker`, `rootDir: engine`)
- Server: Free plan web service, Dockerfile build from GitHub repo (`runtime: docker`, `rootDir: server`)
- Env vars synced from Render dashboard (secrets); `ENGINE_URL` wired from the engine service

### Vercel Deployment (CONFIRMED — `web-next/vercel.json`)

- Framework: Next.js
- Build: `next build`
- Output: `.next`
- Env: `NEXT_PUBLIC_API_URL` from server service

### Keep-Alive (CONFIRMED)

- **External cron:** `.github/workflows/keepalive.yml` pings server `GET /health` every 9 minutes (keeps the free-plan server + BullMQ worker warm)
- **Frontend:** `web-next/lib/usePipeline.ts:56-61` — pings server `/health` every 8 minutes while the pipeline is mounted
- **Engine:** paid/starter plan stays up on its own; sessions evict every 5 min, stuck BullMQ jobs fail at 13 min, retention prunes daily

### Graceful Shutdown (CONFIRMED — `server/src/lib/workerLifecycle.ts`)

- SIGTERM/SIGINT handlers; explicit `bootWorkers()` (replaces the side-effect import)
- Closes: workers (graceful drain) → QueueEvents → queues → Redis connection → history store
- 10 second timeout before force exit
- Engine: cleans up orphaned files on shutdown (`engine/main.py`)

---

## 9. Key Architectural Decisions & Trade-offs

### Local Disk by Default, S3 When Needed (CONFIRMED)

- `engine/core/storage.py` — `STORAGE_BACKEND=local` (default, `LOCAL_STORAGE_DIR`) or `s3` (boto3, presigned browser-direct uploads)
- Layout is bucket-shaped either way: immutable `raw/{session}/{angle}/{uuid}.mp4` + one `results/{job}.mp4`
- **Trade-off:** zero-config single-instance deploys; multi-instance needs a shared bucket (see SCALING.md)

### Synchronous Engine Analysis (CONFIRMED)

- `engine/main.py` — `run_analysis()` called synchronously in `/analyze` (2-worker thread pool)
- BullMQ worker waits for response (`server/src/lib/queue.ts`, 12-min timeout; stuck recovery at 13 min)
- Stage resume reuses a committed summary on retry (skips Gemini, re-tracks landmarks); surviving renders complete directly
- **Trade-off:** Simpler error handling, but single job at a time per engine instance at default concurrency

### In-Memory Sessions (CONFIRMED)

- `engine/main.py:57-58` — Python dict with threading lock
- **Trade-off:** Fast, but sessions lost on restart, no horizontal scaling

### Two Redis Clients (CONFIRMED)

- Server uses both `@upstash/redis` (REST, for general ops) and `ioredis` (TCP, for BullMQ)
- `server/src/lib/redis.ts` handles local vs Upstash routing
- **Trade-off:** BullMQ requires TCP connection; Upstash REST used elsewhere for serverless compatibility

### Frame Caching (CONFIRMED)

- `engine/core/analyzer.py:95` — decoded frames cached during extraction
- Reused for detection + motion scoring (`analyzer.py:600-604`)
- **Trade-off:** Higher memory usage, but avoids ~60 redundant VideoCapture open/seek/read cycles

### Rate Limiting with Memory Fallback (CONFIRMED)

- `server/src/lib/ratelimit.ts:50-53` — Redis-backed with in-memory fallback
- **Trade-off:** Rate limits lost on restart when using memory fallback, but service stays available

### Per-Request Dedup via React.cache (web)

- `web-next/lib/session.ts` + `web-next/lib/serverData.ts` wrap the auth session and server fetchers in `React.cache`, so every cacheable call within a single request shares one execution.
- Layout + `generateMetadata` + page body previously each called `auth0.getSession()` (JWT verify / token refresh) and the underlying fetchers — now once per request.
- **Boundary:** React.cache is RSC-only — client components, middleware (`proxy.ts`), and route handlers keep using `lib/api`/`lib/org`/raw `auth0`.
- **Trade-off:** cache strengthens per-request identity guarantees (all callers agree on one session) with no shared mutable state; it does not cross requests (nothing shared on the server process).

### Fresh Dashboard Data (web)

- Authenticated dashboard/player pages call `unstable_noStore()` — no caching layers intervene; fetches hit the live API. `serverData.ts` fetchers themselves are cache-keyed per request only.
- **Trade-off:** no edge staleness profit on these pages, but they serve per-user live data; the marketing site is the cacheable surface.

### Heavy Client Visuals Loaded Lazy (web)

- recharts is imported only by `components/org/PerformanceChart.tsx`, loaded via `next/dynamic` with `ssr: false` from `StudentProfile`.
- Build splits recharts into its own ~360KB lazy chunk; the student page shell renders without paying that bundle upfront (skeleton fallback while loading).
- Long list/matrix rows (students, reports, attendance grid, history) use `content-visibility: auto` with `contain-intrinsic-size` so off-screen rows skip render/layout.
- **Trade-off:** charts are client-rendered (no SSR of the SVG); acceptable since the data is streamed via RSC pass-down.

### Pure Helpers Under Test (web)

- Cross-cutting formatting/parsing lives in pure modules with unit tests: `lib/csv.ts` (CSV + formula-injection escaping), `lib/analysis.ts` `analysisScore`/`getShotEvents`, `lib/date.ts` converters.
- Test baselines (keep green): server `bun test` 354 pass / 30 files · web `vitest run` 180 tests / 18 files · engine `pytest tests -q` 207 tests · `tsc --noEmit` clean both · `next build` clean · live smoke `server/scripts/smokeOrgHttp.ts` 51 checks. (Verified green 2026-10-11; 10 server skips are env-gated DB tests.)
- **Trade-off:** a thin seam layer over engine-shaped JSON so the app parses defensively without scattering null-guards through components.

---

## 10. Known Gaps, Tech Debt, and Contradictions

### Dead Code (files still present)

None. The last orphans — `engine/core/baseline.py` and `web-next/components/InlineRename.tsx` — were **deleted** (2026-09-17), and legacy `web-next/components/ui/*` is gone (primitives live in `components/9ui/ui/*` + `components/interior/`).

**Not dead (CLI-only, not part of the API pipeline):** `engine/core/player_tracker.py` (frame scoring + box↔skeleton matching, used by `engine/cli/frame_selector.py`) and `engine/core/chunker.py` (>240s video chunking, used by `engine/cli/analyze_session.py` + `main.py`); `chunker` additionally has a dedicated pytest file (`tests/test_chunker.py`). They live, they are tested, and only the API pipeline is unaware of them.

### Removed Dead Code (since last verification)

Previously documented as dead and since **deleted** from the repo — `pipeline.py`, `connection_pool.py`, `compress.py`, `analysis_validator.py`, `overlay.py`, `utils.py` (plus the `register_job_input` no-op stub). Not present in `engine/core/` anymore. (Note: a new `core/quality.py` — the pre-render non-blocking quality gate — has since been added; it is unrelated to the deleted file of the same name.)

Also deleted 2026-09-17: `engine/core/baseline.py` (sport baseline models, never imported) and `web-next/components/InlineRename.tsx` (never imported).

### Inconsistencies

None documented. The HOG descriptor is a single module-level singleton (`core/detection_utils.py:25`) shared by `detector.py` and `analyzer.py` alike.

### Resolved (fixed 2026-09-11)

1. ~~`engine/core/analyzer.py` F821 `Any` never imported~~ — `from typing import Any` added; ruff now clean.
2. ~~`web-next` build failure (17 missing `@/components/interior/*` modules)~~ — the component library now lives in `web-next/components/interior/`; `tsc` and `next build` pass. (The unused `dropdown`, `press-depth`, `sticky-header` imports were dropped rather than implemented.)
3. ~~`docker-compose.prod.yml` engine `SERVER_URL: http://engine:8001`~~ — corrected to `http://server:8000` so engine CORS allows the real server origin.
4. ~~Ghost env vars (`BETA_CODES`, `R2_*`, `STORAGE_BACKEND=r2`, `NEXT_PUBLIC_SUPABASE_URL` on server/web samples)~~ — removed from `docker-compose*.yml`, `render.yaml`, `.env.prod.example`, `engine/.env.sample`, `server/.env.example`, `web-next/.env.example`.
5. ~~`JOB_PRIORITIES.beta` dead entry~~ — removed from `server/src/lib/queue.ts`.
6. ~~ruff config deprecation~~ — `engine/pyproject.toml` now uses `[tool.ruff.lint]`.
7. ~~`render.yaml` `runtime: image` with a GitHub URL~~ — switched to `runtime: docker` + `dockerfilePath: Dockerfile` for both services.

### Resolved (fixed 2026-09-17)

8. ~~Per-call `HOGDescriptor` in `detector.py`~~ — already resolved by the `detection_utils` refactor: one module-level `_HOG_DESCRIPTOR` (`core/detection_utils.py:25`) serves `detector.py` and `analyzer.py`. Doc updated to match reality.
9. ~~Session/scan-progress memory growth in `engine/main.py`~~ — sessions already cap at `MAX_SESSIONS` with every-300s TTL eviction; the unbounded path was the **`scan_progress` dict**, which was never pruned. Added `_evict_old_scan_progress()` (only reachable fix) — stale entries are dropped by the 2h TTL; completed entries are retained for only 5 min (`COMPLETE_SCAN_PROGRESS_RETENTION`). `started_at` is stamped on every entry.
10. ~~Two Redis libraries in `server/`~~ — redis is ioredis-only now. `server/src/lib/redis.ts` derives a `rediss://` URL from `UPSTASH_REDIS_REST_URL` + `_TOKEN` (same derivation as `queue.ts`, already proven in prod by BullMQ) or uses the local URL; the Upstash REST branch and both `@upstash/redis` and `@upstash/ratelimit` dependencies are gone.
11. ~~`lib/notifications.ts` tsc errors~~ — `DashboardAnalysis` now carries `auth0_id` (matches the `analysis_history` row shape); `orgValidate.ts` status-set typed as `ReadonlySet<string>` (mirrors `routes/org.ts`); lint fixes in the notifications file.

### Missing Features

**CI/CD is active** — `.github/workflows/ci.yml` (engine pytest + ruff, server typecheck/lint/tests, web typecheck/lint/tests/build), `deploy.yml` (Vercel + Render deploy hooks), `keepalive.yml` (9-min server ping cron).

### Technical Debt

1. **Notifications DB integration tests are env-gated** — `server/tests/notifications.test.ts` keeps three DB-touching tests skipped unless `DATABASE_URL` points at a reachable database. Locally, Bun auto-loads `server/.env`, so those tests run against the live Neon DB. CI without `DATABASE_URL` stays green.
2. **Per-org queue aging is open** — priority tilt (signed-in 10 + tier bump over anonymous 0) and the daily per-org cap exist; fair-share aging across orgs does not.
3. **No K8s/GPU path** — explicitly out of scope until workload demands (see `docs/TARGET_ARCHITECTURE_PLAN.md`).

---

## 11. How to Verify This Document

| Claim | Verification |
|-------|--------------|
| Next.js ^16.3.5 | `web-next/package.json:20` |
| Elysia ^1.4.30 | `server/package.json:19` |
| FastAPI 0.141.1 | `engine/requirements.txt:1` |
| google-genai 2.25.0 | `engine/requirements.txt:4` |
| Worker concurrency default: 1 | `server/src/lib/queue.ts` (`WORKER_CONCURRENCY`, default 1) |
| Worker timeout: 12 min | engine analyze call in `server/src/lib/engine.ts` |
| Stuck job recovery: 13 min | `server/src/lib/queue.ts` (`STUCK_MS`, 10-min sweep) |
| Session TTL: 2 hours | `engine/main.py` (`SESSION_TTL=7200`, max 10 sessions) |
| Cache TTL: 24 hours | `engine/core/cache.py` (`CACHE_TTL=86400`) |
| Rate limit: scan 10/min | `server/src/lib/ratelimit.ts` (`SCAN_RATE_LIMIT`) |
| Rate limit: analysis 5/hour | `server/src/lib/ratelimit.ts` (`ANALYSIS_RATE_LIMIT`) |
| Rate limits: chat/download/clips/email/aireport | `server/src/lib/ratelimit.ts` (30/hr, 60/hr, 60/hr, 20/day/org, 10/hr/org) |
| Local or S3 storage | `engine/core/storage.py` (`STORAGE_BACKEND`, `raw/…` + `results/…` keys) |
| Direct-upload intents | `POST /upload-intent` + `POST /scan-from-key` in `engine/main.py` |
| Pipeline states | `engine/core/jobs.py` (`STATE_FLOW`, `PIPELINE_STATES`) |
| Test suite: 207 tests | `cd engine && python -m pytest tests -q` (19 files) |
| Test suite: 354 pass / 30 files | `cd server && bun test` (10 env-gated DB tests skip without reachable infra; verified green 2026-10-11) |
| Test suite: 180 tests / 18 files | `cd web-next && npx vitest run` (verified green 2026-10-11) |
| Live smoke: 51 checks | `cd server && bun run smoke` (needs `.env` + running server + Neon DB) |
| Dead code deleted: baseline.py, InlineRename.tsx, ui/* | `rg "baseline" engine/core engine/main.py`, `rg "InlineRename" web-next/`, `ls web-next/components/ui` — all empty |
| player_tracker.py/chunker.py are CLI-only (kept) | imported by `engine/cli/` only; `tests/test_chunker.py` exists |
| scan_progress pruned | `engine/main.py`: `SCAN_PROGRESS_TTL` / `COMPLETE_SCAN_PROGRESS_RETENTION`, evicted alongside sessions |
| HOG singleton | `engine/core/detection_utils.py` module-level descriptor used by `detector.py` + `analyzer.py` |
| Redis is ioredis-only | `server/src/lib/redis.ts`; `rg "@upstash" server/package.json` returns nothing (engine Python still uses `upstash-redis`) |
| Auth0 auth (beta gate removed) | `grep -rn "BETA_CODES" server/src/` returns nothing |
| Keep-alive: 9 min (external cron) | `.github/workflows/keepalive.yml` → `GET /health` |
| Frontend status poll: 8 min | `web-next/lib/usePipeline.ts` |
| Session via React.cache | `web-next/lib/session.ts` wraps `auth0.getSession` in `React.cache` |
| Server fetchers via React.cache | `web-next/lib/serverData.ts` wraps `lib/api`/`lib/org` fetchers |
| recharts isolated in own chunk | `components/org/PerformanceChart.tsx` imported via `next/dynamic` (`ssr: false`) |
| content-visibility on list rows | `rg -l "content-visibility" web-next/components/org web-next/app/dashboard` |
| CSV formula injection escaped | `web-next/lib/csv.ts` prefixes `= + - @ tab CR`-leading strings |
| Findings + evidence gate | `engine/core/findings.py` (`build_findings`, `enforce_evidence_gate`); server re-gate at persist |
| Prompt-injection delimiters | `engine/core/prompt_guard.py` (`UNTRUSTED-USER-CONTENT` / `ORG-DATA`) |
| Version stamping / provenance | `engine/core/config.py` (`ENGINE_VERSION`, prompt versions) + sport-pack `version` keys |
| X-Request-Id chain | web→server→engine (generated per call, forwarded through the queue worker) |

---

*Last verified: 2026-10-11 (deepening pass built + verified green: data core, unified pipeline, admission incl. me.ts roster scope, orgData subdomain split, worker lifecycle, jobGuard + chatTurn, page shell; baselines 354/180/207)*
