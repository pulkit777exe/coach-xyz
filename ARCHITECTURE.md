# Coach-XYZ Architecture

## 1. Overview

Coach-XYZ is a sports video analysis platform that uses Google Gemini AI to analyze athlete technique. Users upload sports videos (basketball, football, cricket, tennis, baseball, hockey), the system detects players, sends frames to Gemini for biomechanical analysis, and returns an annotated video with performance feedback. The system is designed for zero-cost deployment on free-tier infrastructure.

---

## 2. Tech Stack

### Frontend (`web-next/`)
| Technology | Version | Source |
|------------|---------|--------|
| Next.js | ^16.2.12 | `web-next/package.json:15` |
| React | ^19.2.8 | `web-next/package.json:16` |
| Tailwind CSS | ^4.3.3 | `web-next/package.json:24` |
| GSAP | ^3.15.0 | `web-next/package.json:14` |
| TypeScript | ^5.9.3 | `web-next/package.json:25` |
| @auth0/nextjs-auth0 | ^4.26.0 | `web-next/package.json:11` |
| @sentry/nextjs | ^10.69.0 | `web-next/package.json:13` |

### Server (`server/`)
| Technology | Version | Source |
|------------|---------|--------|
| Bun | (runtime) | `server/Dockerfile:1` — `oven/bun:1` |
| Elysia | ^1.4.30 | `server/package.json:19` |
| BullMQ | ^5.81.5 | `server/package.json:18` |
| ioredis | ^5.11.1 | `server/package.json:20` |
| @sentry/node | ^10.74.0 | `server/package.json:17` |
| TypeScript | ^5.9.3 | `server/package.json:25` |

### Engine (`engine/`)
| Technology | Version | Source |
|------------|---------|--------|
| Python | 3.11 | `engine/Dockerfile:1` |
| FastAPI | 0.141.1 | `engine/requirements.txt:1` |
| uvicorn | 0.52.0 | `engine/requirements.txt:2` |
| boto3 | >=1.34.0 | `engine/requirements.txt:3` (S3 backend, imported lazily) |
| google-genai | 2.15.0 | `engine/requirements.txt:4` |
| httpx | 0.28.1 | `engine/requirements.txt:5` |
| mediapipe | 1.0.0 | `engine/requirements.txt:6` |
| opencv-python-headless | 4.13.0.92 | `engine/requirements.txt:8` |
| orjson | 3.11.9 | `engine/requirements.txt:10` |
| sentry-sdk | 2.66.1 | `engine/requirements.txt:15` |
| upstash-redis | 1.7.0 | `engine/requirements.txt:16` |

### Infrastructure
| Component | Technology | Source |
|-----------|------------|--------|
| Queue | BullMQ + Redis | `server/src/lib/queue.ts:1` |
| Job Storage | Upstash Redis (REST) | `engine/core/jobs.py:10-17` |
| Server Redis | ioredis (TCP; `rediss://` URL derived from Upstash REST creds) | `server/src/lib/redis.ts:6-48` |
| Database | Supabase PostgreSQL | `server/src/lib/historyStore.ts:13-17` |
| Video Storage | Local filesystem (default; S3 opt-in) | `engine/core/storage.py:46-51` |
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
│   ├── app/page.tsx           # Home — renders AppClient (SPA pipeline)
│   ├── app/account/page.tsx   # Account / profile page (Auth0 session)
│   ├── app/api/service/[[...path]]/route.ts  # Identity proxy (org/auth/me/sync)
│   ├── app/player/           # Player Hub (read-only face)
│   │   ├── layout.tsx         # Player shell (session required)
│   │   └── page.tsx           # Role gate → PlayerHub
│   ├── app/dashboard/         # Dashboard (requires Auth0 session; role gate → /player)
│   │   ├── layout.tsx         # Sidebar layout with DashboardNav
│   │   ├── page.tsx           # Overview — stats + recent analyses
│   │   ├── history/page.tsx   # Paginated analysis history
│   │   └── analysis/[id]/     # Analysis detail
│   │       ├── page.tsx       # Server component — fetches initialData
│   │       └── chat/page.tsx  # Chat route (V2 — see V2_COACH.md)
│   ├── components/            # UI components
│   │   ├── AppClient.tsx      # Pipeline state machine (idle→uploading→…→chatting)
│   │   ├── AnalysisDetailClient.tsx  # Detail page polling + expired state
│   │   ├── AnalysisProgress.tsx      # In-progress view
│   │   ├── ResultsSummary.tsx        # Completed analysis view
│   │   ├── ErrorScreen.tsx           # Structured error display
│   │   ├── LandingPage.tsx           # Upload entry point
│   │   ├── PlayerSelector.tsx        # Player crop selection
│   │   ├── AuthHeader.tsx            # Fixed top nav (Auth0 session-aware)
│   │   ├── DashboardNav.tsx          # Active-link sidebar nav (client component)
│   │   ├── ChatLayout.tsx            # V2 chat split-screen layout
│   │   ├── ChatPanel.tsx             # V2 chat message list + input
│   │   ├── ChatMessage.tsx           # V2 individual message bubble
│   │   ├── ChatInput.tsx             # V2 chat text input
│   │   ├── ChatTyping.tsx            # V2 typing indicator
│   │   ├── HistoryChat.tsx           # Per-analysis chat (history detail page)
│   │   ├── VideoPlayer.tsx           # Video player with timestamp controls
│   │   ├── QuickActions.tsx          # Pre-built chat action buttons
│   │   ├── AnalysisTitle.tsx         # Click-to-rename analysis heading
│   │   ├── GlobalSearch.tsx          # Org-level search (fuzzy, client-side + proxy)
│   │   ├── UserAvatar.tsx            # Auth0 profile picture / initials
│   │   ├── org/                      # Coach dashboard: StudentsClient, AttendanceGrid,
│   │   │                             #   ScheduleClient, ReportsClient, StudentProfile,
│   │   │                             #   PerformanceChart (dynamic), dialogs
│   │   ├── player/                   # PlayerHub (read-only player view)
│   │   └── 9ui/ui/                   # shadcn-style primitives (button, badge, card, chart, …)
│   ├── lib/
│   │   ├── api.ts             # API client (identity-bearing + pipeline fetch calls)
│   │   ├── auth0.ts           # Auth0Client singleton
│   │   ├── org.ts             # Org domain: entity types, org API client, enum vocab + labels
│   │   ├── session.ts         # React.cache wrapper — auth0.getSession (RSC only)
│   │   ├── serverData.ts      # React.cache-wrapped server fetchers (RSC pages import these)
│   │   ├── analysis.ts        # Pure helpers: analysisScore, getShotEvents (from summary_json)
│   │   ├── csv.ts             # toCSVString (formula-injection-safe CSV escaping)
│   │   ├── date.ts            # ISO date/time conversions + scheduleMonthWindow
│   │   ├── sports.ts          # Sport emoji helpers
│   │   ├── usePipeline.ts     # Pipeline state hook (idle→…→chatting→error)
│   │   ├── jobPolling.ts      # Single job-status poll engine (injected clock/fetch/callbacks)
│   │   ├── pipelineState.ts   # ENGINE_STATE_MAP + mapEngineStateToPipeline
│   │   ├── errors.ts          # Client error normalization + transient classification
│   │   ├── sse.ts             # Shared SSE line parser (data: JSON)
│   │   ├── utils.ts           # cn() class-name helper + capitalize
│   │   └── __tests__/         # lib unit tests (csv, analysis, date, api, org, etc.)
│   ├── proxy.ts               # Auth0 middleware proxy (Next.js 16)
│   └── types/index.ts         # Shared type definitions
│
├── server/                    # Middleware server (Bun + Elysia)
│   ├── src/index.ts           # Entry point, CORS, security headers, error handler
│   ├── src/routes/
│   │   ├── scan.ts            # POST /api/scan-video — upload + player detection (+ scan-intent/scan-from-key/progress proxy)
│   │   ├── analyze.ts         # POST /api/analyze-video — enqueue analysis job
│   │   ├── status.ts          # GET /api/job-status/:jobId — poll progress
│   │   ├── download.ts        # GET /api/download/:jobId — stream result video
│   │   ├── chat.ts            # POST /api/chat/stream (SSE) + GET /api/conversation/:jobId — V2 chat proxy to engine (server exposes no non-streaming chat route)
│   │   ├── findings.ts        # /api/auth/.../findings{,/trends,/export} + review routes (split out of auth.ts)
│   │   ├── clips.ts           # /api/auth/.../analyses/:jobId/clips — list/create/delete (split out of auth.ts)
│   │   ├── chatHistory.ts     # /api/auth/.../analyses/:jobId/chat — transcript + ask (split out of auth.ts)
│   │   ├── email.ts           # POST /api/email/:auth0Id/{invite|report|attendance} (Resend, guarded)
│   │   ├── auth.ts            # /api/auth/* composer — sync, user, analyses, stats, rename/cancel/delete; mounts findings/clips/chatHistory sub-routers (guarded)
│   │   ├── org/               # /api/org/:auth0Id/* — coach org subdomains, one module per subdomain (index.ts composes; guarded)
│   │   ├── me.ts              # /api/me/* — player read-only hub (guarded, self-scoped) + mint endpoint
│   │   └── health.ts          # GET /health (frontend + Docker healthcheck), /health/deep (ops-only probe — no frontend consumer)
│   ├── src/lib/
│   │   ├── queue.ts           # Single BullMQ wiring: queues + workers + stuck-job recovery + shutdown — LAZY: importing connects nothing; index.ts calls startQueueInfrastructure() first / stopQueueInfrastructure() on shutdown (notifications.ts attaches via onQueueInfrastructureReady)
│   │   ├── redis.ts           # Redis client (Upstash REST or local ioredis)
│   │   ├── jobs.ts            # Server-side job mapping (server_job_id → engine_job_id)
│   │   ├── engine.ts          # HTTP client to engine (/scan, /analyze, /status, /download)
│   │   ├── ratelimit.ts       # Rate limiting buckets + shared rateLimited() 429 rejection helper
│   │   ├── attribution.ts     # Mint/verify signed attribution tokens (sub.exp.HMAC, SERVICE_TOKEN)
│   │   ├── logger.ts           # winston singleton (LOG_LEVEL/LOG_FORMAT, key-based redaction, Sentry bridge) — the only logging seam
│   │   ├── requestLog.ts       # Pure access-log helpers — shouldLogRequest (/health skip) + formatAccessLog (pathname-only)
│   │   ├── serviceGuard.ts    # SERVICE_TOKEN + verified-auth0-id identity guard
│   │   ├── uuid.ts            # Single UUID_RE — canonical UUID pattern for every id check
│   │   ├── aiResponse.ts      # Analysis-chat fallback responder + system prompt (extracted from auth.ts)
│   │   ├── orgEnums.ts        # Shared org vocab (values/order contract w/ web lib/org.ts)
│   │   ├── org/               # Domain modules: students, attendance, schedule, reports, performance, wellness, plans, compete, objectives, overview
│   │   ├── orgData.ts         # 103-line named-re-export barrel over org/* (public import surface unchanged)
│   │   ├── historyStore.ts    # Supabase connection + ALL DDL — sole schema owner (ensureInitialized)
│   │   ├── userRoles.ts       # coach/player role vocab (contract w/ web lib/userRoles.ts)
│   │   ├── conversation.ts    # Redis-backed conversation storage (V2)
│   │   ├── transcript.ts      # Transcript interface — playerTranscript (Redis) / dashboardTranscript (Postgres) chat-store seam (no store merge)
│   │   ├── sse.ts             # Buffered SSE parsing — createSseLineBuffer / parseSseDataEvents (chunk-straddle safe)
│   │   ├── caller.ts          # resolveCaller + requireVerifiedSelf/missingVerifiedSelf self-scope identity helpers
│   │   ├── analysisAdmission.ts # admitAnalysis: quota → tier → priority → usage (single admission gate for both analyze routes)
│   │   ├── retention.ts       # Retention sweep scheduling — start/stopRetentionSweep (24h cadence + 60s first run)
│   │   └── errors.ts          # Error builders + status posture helpers (enginePassthroughStatus / chatEngineStatus / errorBody)
│   └── src/types/index.ts     # Shared API types
│
├── engine/                    # Video analysis engine (Python + FastAPI)
│   ├── main.py                # Thin app (221 lines): env guard, Sentry, CORS, middlewares,
│   │                          #   exception handlers, lifespan (eviction loop + shutdown sweep), 8 router includes
│   ├── sessions.py            # In-memory session store + scan-progress + eviction
│   │                          #   (SESSION_TTL/MAX_SESSIONS, delete_session_files)
│   ├── api/                   # HTTP surface — one router per domain
│   │   ├── scan.py            # POST /scan, /upload-intent, /scan-from-key; GET /scan-progress/{token} (SSE)
│   │   ├── analyze.py         # POST /analyze — synchronous run_analysis in thread pool
│   │   ├── chat.py            # POST /chat, /chat/stream (SSE)
│   │   ├── report.py          # POST /report — one-click AI report
│   │   ├── jobs.py            # GET /status/{id}, POST /fail/{id} + download router (GET /download/{id})
│   │   ├── health.py          # GET /health, /health/deep
│   │   ├── sports.py          # GET /sports/{sport}/positions (vocab from sport packs)
│   │   └── errors.py          # error_response() — the one HTTP error-body shape
│   ├── cli/                   # CLI-only modules (never imported by the API pipeline)
│   │   ├── main.py / analyze_session.py / frame_selector.py
│   │   ├── gemini.py          # CLI Gemini entry point (moved from core/)
│   │   ├── chunker.py         # Video chunking (moved from core/)
│   │   └── player_detector.py # Alternate player detection path (moved from core/)
│   ├── core/
│   │   ├── analyzer.py        # Main analysis pipeline (run_analysis)
│   │   ├── detector.py        # Player detection (HOG + MediaPipe pose)
│   │   ├── renderer.py        # Video annotation (HUD, landmarks, summary)
│   │   ├── gemini_client.py   # Gemini call + normalize (active; shared client singleton)
│   │   ├── gemini_common.py   # Shared Gemini helpers
│   │   ├── chat_client.py     # Gemini invocation for /chat + /chat/stream (routers stay transport-only)
│   │   ├── report_client.py   # Gemini invocation for /report
│   │   ├── chat_prompt.py     # V2 chat prompt builder
│   │   ├── report_prompt.py   # Report prompt builder
│   │   ├── prompt.py          # Analysis system prompt for Gemini
│   │   ├── prompt_guard.py    # UNTRUSTED/ORG-DATA prompt-injection delimiters
│   │   ├── validator.py       # Gemini output schema validation
│   │   ├── sport_config.py    # Sport vocabulary SSOT: SPORTS / SPORT_EMOJIS / sport_emoji() / sport_pack_ids() + pack loader
│   │   ├── findings.py        # Per-event findings (ids, severity, evidence frames, provenance)
│   │   ├── quality.py         # Pre-render stage quality gate
│   │   ├── multicam.py        # Multi-angle session helpers + per-angle progress keys
│   │   ├── jobs.py            # Engine-side job state machine (Redis)
│   │   ├── cache.py           # Video hash + Redis caching
│   │   ├── dedup.py           # Request deduplication
│   │   ├── storage.py         # Local file storage
│   │   ├── video_io.py        # FFmpeg preprocessing + keyframe extraction
│   │   ├── tracking.py        # Player track building + motion scoring
│   │   ├── pose_backend.py    # MediaPipe pose detection abstraction
│   │   ├── detection_utils.py # Shared detection helpers
│   │   ├── stats.py           # Shot-event stat validation + correction
│   │   ├── injury_risk.py     # Injury-risk indicator computation
│   │   ├── player_tracker.py  # Player tracking (CLI only — imported by cli/frame_selector.py)
│   │   ├── config.py          # Engine configuration constants + ENGINE_VERSION
│   │   ├── logging_config.py  # Structured logging setup
│   │   └── errors.py          # Error types hierarchy
│   ├── tests/                 # pytest suite (225 tests)
│   └── requirements.txt       # Python dependencies (single runtime manifest — pyproject is tooling-only)
│
├── docker-compose.yml         # Local development (engine + server)
├── docker-compose.prod.yml    # Production compose
├── render.yaml                # Render deployment config
└── sports/                    # Sport-specific configs (basketball.json, football.json, cricket.json, tennis.json, baseball.json, hockey.json)
```

---

## 4. Data Model

### Redis Data Structures

**Engine Jobs** (`engine/core/jobs.py:20`)
- Key: `coachai:job:{job_id}`
- TTL: 7200 seconds (2 hours)
- Shape: `JobStatus` dataclass (job_id, state, stage, stage_name, progress, complete, error, error_code, retryable, summary, video_key, video_path, created_at)
- States: uploading → scanning → player_selection → analyzing → rendering → completed (or → failed)

**Error Responses** (wire shape in `server/src/lib/errors.ts`; status + retryable owned by the engine)
- All error responses conform to the `CoachAIError` shape:
  - `code: string` — machine-readable error code (e.g. `ANALYSIS_FAILED`, `JOB_NOT_FOUND`)
  - `message: string` — human-readable error message
  - `layer: "engine" | "server" | "client"` — where the error originated
  - `retryable: boolean` — whether the client should retry the request
  - `retry_after?: number` — seconds to wait before retrying (optional, server rate-limit rejections)
- The `isCoachAIError` type guard validates the four core fields; `errorBody()` strips the server-internal stamp so the wire stays these fields only.
- **Ownership:** the engine owns code → HTTP status (`STATUS_BY_CODE`) and code → retryable (`RETRYABLE_BY_CODE`, both `engine/core/errors.py`; unregistered codes fall back to 422-if-retryable/500 for status and `status >= 500` for retryable). `throwNonOk` (`lib/engine.ts`) stamps the status the engine answered with onto the thrown `CoachAIError.status` (server-internal, never serialized). Routes derive their HTTP status only via the posture helpers in `lib/errors.ts` — `enginePassthroughStatus` (scan/download pass-through), `chatEngineStatus` (chat: 4xx passes through, ≥500 → 502, statusless → route applies its connectivity posture) — and never re-map codes to statuses themselves.
- **`JOB_NOT_FOUND` is `retryable: false` on every path** (miss, expired-supabase, and the 200-poll expired answer) — one code, one meaning; tests pin both directions.

**Server Job Mappings** (`server/src/lib/jobs.ts:3-4`)
- Key: `coachai:srv:{server_job_id}`
- TTL: 7200 seconds (2 hours)
- Shape: `{ server_job_id, engine_job_id, session_token, player_index, model, created_at, owner_ids }`
- `owner_ids` binds the job to its verified owners (analyze-video: the `x-attribution` sub; me/analyze: `[coachAuth0Id, requestedBy]`). Empty = anonymous demo job, bearer-readable. Status/chat/conversation/download require a matching `x-attribution` sub when owners exist (`server/src/lib/jobAccess.ts`).

**Rate Limits** (`server/src/lib/ratelimit.ts`)
- Key: `rl:scan:{sub|ip}` (TTL 60s) — 10 requests/minute (`SCAN_RATE_LIMIT`, default `"10"`)
- Key: `rl:analysis:{sub|ip}` (TTL 3600s) — 5 requests/hour (`ANALYSIS_RATE_LIMIT`, default `"5"` — the 429 message in `analyze.ts` states "5 per hour", consistent)
- Key: `rl:chat:{sub|ip}` (TTL 3600s) — 30 AI chats/hour (`CHAT_RATE_LIMIT`, default `"30"`)
- Key: `rl:download:{sub|ip}` (TTL 3600s) — 60 downloads/hour (`DOWNLOAD_RATE_LIMIT`, default `"60"`)
- Key: `rl:scanprogress:{ip}` (TTL 60s) — 30 SSE opens/minute (`SCAN_PROGRESS_RATE_LIMIT`, default `"30"`)
- Scan/analysis/chat/download buckets key on the verified attribution sub when the caller sends `x-attribution` (unspoofable per-account bucket); anonymous callers share the IP bucket.

**Video Cache** (`engine/core/cache.py:26-27`)
- Key: `coachai:analysis:{video_hash}:p{player_index|all}`
- TTL: 86400 seconds (24 hours)
- Shape: Full Gemini analysis JSON

**Cache Metadata** (`engine/core/cache.py:87-93`)
- Key: `coachai:analysis:{video_hash}:metadata`
- Shape: `{ video_path, cached_at, access_count }`

### Supabase Tables (CONFIRMED — all DDL in `server/src/lib/historyStore.ts`, sole owner `ensureInitialized`)

**video_conversations**
- Primary key: `session_token`
- Fields: file_name, file_mime_type, file_size_bytes, player_count, players_json, scan_response_json, client_ip, user_agent, source, auth0_id

**analysis_history**
- Primary key: `server_job_id`
- Fields: engine_job_id, session_token, player_index, model, stage, stage_name, progress, complete, video_ready, summary_json, status_json, error_code, error_message, download_count, display_name, auth0_id, requested_at, completed_at

**users**
- Primary key: `id` (UUID)
- Unique: `auth0_id`
- Fields: auth0_id, email, name, nickname, picture, email_verified, `linked_auth0_ids` (text[]), `role` (text, 'coach' | 'player', default 'coach', CHECK constraint), created_at, updated_at
- Purpose: Auth0 user sync — upserted on every login via `POST /api/auth/sync`. `role` defaults to `coach` (first account is a coach); a player's role is flipped to `player` when their login email auto-links to a student row. `linked_auth0_ids` merges multiple providers on one account.

**students** (org — scoped by owning coach `auth0_id`)
- Fields (DDL in `server/src/lib/historyStore.ts`; queries in `server/src/lib/org/students.ts`): full_name, email, phone, sport, position, jersey_number, date_of_birth, gender, guardian_name, guardian_phone, notes, status (CHECK: STUDENT_STATUSES), joined_on, `account_auth0_id` (player login link, indexed), created_at, updated_at
- Purpose: the coach's roster. A player's account is linked to their student row by email on first player login (`account_auth0_id` set, user `role` → 'player').

**attendance** / **schedule_events** / **reports** / **performance_metrics** (org)
- All scoped by owning coach `auth0_id`; attendance/performance also reference `student_id`. Player read-only views query these with the coach scope + the linked student. (CHECK constraints pin the shared vocab in `server/src/lib/orgEnums.ts`, mirrored contractually in `web-next/lib/org.ts`.)
- **Uniqueness is org-scoped** (migrated 2026-09-21): `attendance` has a `UNIQUE (auth0_id, student_id, session_date)` constraint (`attendance_auth0_student_session_unique`) and `performance_metrics` a `UNIQUE (auth0_id, student_id, metric_key, measured_at)` (`performance_auth0_student_metric_unique`) — the legacy `UNIQUE (student_id, …)` keys were auto-dropped/migrated idempotently in `ensureInitialized` (`historyStore.ts`), and the upsert `ON CONFLICT` targets in `lib/org/*` match. This stops one org's rows from colliding with another org's same-id student rows.

**chat_messages**
- Primary key: `id` (UUID)
- Fields: server_job_id, auth0_id, role (user/assistant/system), content, timestamp_refs (jsonb), event_refs (jsonb), created_at
- Purpose: Persistent per-analysis chat history (V2 feature)
- Served through the `Transcript` seam (`server/src/lib/transcript.ts`): `dashboardTranscript` (Postgres, this table) and `playerTranscript` (Redis `coachai:conv:*`) implement one interface — the seam exists so stores can converge later; they are deliberately NOT merged today.

### In-Memory State

**Engine Sessions** (`engine/sessions.py`)
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
  in `delete_session_files`, `engine/sessions.py`), so re-analysis (other player, other angle,
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
   → web-next/lib/api.ts scanVideoWithProgress
   → server/src/routes/scan.ts:76

2. Server validates (rate limit, file type, size < 500MB)
   → server/src/routes/scan.ts:77-122

3. Server forwards to Engine POST /scan
   → server/src/lib/engine.ts:67-102 (180s timeout)

4. Engine streams upload to local storage
   → engine/api/scan.py:250-284 (stream-to-storage block)

5. Engine runs player detection (HOG + MediaPipe)
   → engine/api/scan.py:124-125
   → engine/core/detector.py

6. Engine creates session (in-memory dict)
   → engine/api/scan.py:151-169 (session record; token minted at :245-248, store in `engine/sessions.py`)

7. Engine warms cache for video hash
   → engine/api/scan.py:181-184
   → engine/core/cache.py:77-93

8. Server persists to Supabase + returns session_token
   → server/src/routes/scan.ts:135-139 (helper at :32-56)

9. [Optional] Frontend subscribes to scan progress via SSE
   → GET /api/scan-progress/:sessionToken (server/src/routes/scan.ts:312, proxies raw SSE)
   → GET /scan-progress/{session_token} (engine/api/scan.py:416)
```

### Flow 2: Analysis (CONFIRMED)

```
1. Frontend POST /api/analyze-video { session_token, player_index }
   → web-next/lib/api.ts startAnalysis
   → server/src/routes/analyze.ts:21

2. Server creates server_job_id + engine_job_id
   → server/src/routes/analyze.ts:62-63

3. Server admits the job — `admitAnalysis` (`lib/analysisAdmission.ts`): per-org
   daily quota → tier → priority (base 5 here; 10 from /api/me/analyze; elite +10,
   pro +5) → usage record — then saves the job mapping to Redis and enqueues to
   BullMQ (single call — enqueueAnalysis: saveJob, then analysisQueue.add)
   → server/src/routes/analyze.ts:75 (admitAnalysis), :81 (enqueueAnalysis)
   → server/src/lib/analysisAdmission.ts
   → server/src/lib/queue.ts:260 (enqueueAnalysis)
   → server/src/lib/jobs.ts:18-22 (saveJob)

4. Server persists the analysis row to Supabase
   → server/src/routes/analyze.ts:99-107 (persistAnalysisStart)

5. Engine job state in Redis is created lazily by the engine itself on
   POST /analyze — the server never writes engine job keys
   → engine/api/analyze.py:93-98

6. BullMQ worker picks up job (concurrency: 1)
   → server/src/lib/queue.ts:160,301,462-465 (createWorkerProcessor template; `new Worker`; WORKER_CONCURRENCY env at :465)

7. Worker calls Engine POST /analyze (12 min timeout)
   → server/src/lib/queue.ts:307 (worker → analyzeVideo)
   → server/src/lib/engine.ts:251-252 (withTimeout … 12 * 60 * 1000)

8. Engine runs analysis synchronously
   → engine/api/analyze.py:65 (run via thread pool at :128-135)
   → engine/core/analyzer.py:807
   a. Download video from local storage
   b. Check Redis cache → return if hit
   c. Check deduplication → wait if in-progress
   d. Preprocess video (FFmpeg normalize)
   e. Extract keyframes (every 3s, max 30)
   f. [PARALLEL] Detect players + Compute motion scores
   g. Call Gemini API with best frames
   h. Cache result in Redis
   i. Render annotated video
   j. Upload result to local storage

9. Server resolves status: the job mapping is read from Redis, then the
   computed status is fetched from the engine over HTTP and persisted to
   Supabase (the Supabase row serves as the fallback once the Redis mapping
   expires)
   → server/src/routes/status.ts:39-79 (mapping read at :40, engine HTTP at :79, Supabase fallback at :44-66)
   → server/src/lib/jobs.ts:24-42 (getJob)
```

### Flow 3: Download Result (CONFIRMED)

```
1. Frontend GET /api/download/:jobId
   → web-next/lib/api.ts getDownloadUrl / getAuthorizedDownloadUrl
   → server/src/routes/download.ts:11

2. Server looks up engine_job_id from Redis
   → server/src/lib/jobs.ts:24-42 (getJob)

3. Server streams from Engine GET /download/:jobId
   → server/src/lib/engine.ts:177-203 (60s timeout at :188)

4. Engine serves file from local storage
   → engine/api/jobs.py:80 (download router)
   → engine/core/storage.py:89-93 (get_local_file_path, path-checked at :77-86; S3 backend 302s a presigned GET at api/jobs.py:102-106)
```

### Flow 4: Chat with AI Coach (IMPLEMENTED — formerly V2)

The server exposes **one** chat wire route: `POST /api/chat/stream` (SSE). The non-streaming `POST /api/chat` route was removed (2026-09-24 — the web only ever called `/chat/stream`). The engine keeps both `POST /chat` (used by the auth-scoped dashboard chat) and `POST /chat/stream`.

**Streaming (SSE)** (`POST /api/chat/stream`)
1. Frontend POSTs `{ job_id, message }` with `Accept: text/event-stream`
   → web-next/lib/api.ts `sendChatMessageStream` (AsyncGenerator over SSE)
   → server/src/routes/chat.ts
2. Server loads prior turns through `playerTranscript` (`lib/transcript.ts`, Redis `coachai:conv:*`), POSTs to engine `POST /chat/stream` (120s timeout) and `tee()`s the body
   → engine/api/chat.py → engine/core/chat_client.py (SSE token stream with final `done` event)
3. Relays the stream to the client; a background parser consumes the tee'd copy with the buffered `parseSseDataEvents` (`lib/sse.ts` — a `data:` line straddling two chunks is reassembled, not dropped) and persists the completed reply on the `done` event
4. Engine error responses surface shaped: body via `errorBody`, status via `chatEngineStatus` (4xx pass through, ≥500 → 502)

**Auth-scoped chat** (`/api/auth/user/:auth0Id/analyses/:jobId/chat` — GET/POST, `server/src/routes/chatHistory.ts`, mounted by auth.ts) persists messages to Supabase `chat_messages` through `dashboardTranscript` and calls the engine via `askEngineChat(payload, requestId)` (`lib/engine.ts` → engine `POST /chat`, 30s deadline). Posture: an engine **error response** surfaces as a CoachAIError (4xx pass through, else 502) — no silent fallback; only **connectivity loss** (statusless `ENGINE_UNAVAILABLE`) falls back to the deterministic keyword responder `generateSimpleResponse` (`server/src/lib/aiResponse.ts`), pinned by test. The dead `system_prompt` field and `buildChatSystemPrompt` were deleted — the engine builds its prompt from the job summary; only `job_id`, `message`, `conversation_history` go on the wire.

---

## 6. Authentication & Authorization

### Auth0 (CONFIRMED — replaces earlier "beta code gate" description)

The system uses Auth0 for user authentication. The beta-code gate described in earlier versions of this document **no longer exists** in the server code.

- **Provider:** `@auth0/nextjs-auth0` v4.26.0 (`web-next/package.json`)
- **Client:** `web-next/lib/auth0.ts` — `Auth0Client` singleton with 30s HTTP timeout
- **Session check:** `getSession()` from `lib/session.ts` (React.cache wrapper over `auth0.getSession`) called in every protected server component; deduplicated within a single request so layout + generateMetadata + page call the JWT verify once
- **Protected routes:** `/dashboard/*`, `/account` — redirect to `/auth/login` when session absent
- **User identity:** `session.user.sub` (Auth0 subject claim, e.g. `google-oauth2|123` or `github|456`)
- **User sync:** On account page load, `POST /api/auth/sync` upserts the user into the `users` Supabase table. New accounts default to `role = 'coach'` (first account is a coach); when the login email matches a student row, the account is auto-linked (`students.account_auth0_id` set) and its role flips to `player`.
- **Social providers:** Google and GitHub are configured in the Auth0 tenant dashboard (confirmed by CSP `img-src` allowing `*.googleusercontent.com` and `*.githubusercontent.com` in `web-next/next.config.ts`)
- **Logout:** `/auth/logout` (Auth0 SDK route)
- **`auth0_id` attribution on capability routes:** capability-token routes can't transit the identity proxy (uploads/SSE), so scan/analyze attribution uses a **signed attestation token** instead of a raw client header. The web app fetches `GET /api/me/attribution/mint` (self-scoped, behind serviceGuard) which returns a short-lived HMAC-SHA256 token binding the **verified session sub** (`sub.exp.exp-hmac`, TTL 10 min, keyed by `SERVICE_TOKEN`, `server/src/lib/attribution.ts`). Browser-direct scan (`POST /api/scan-video`), analyze (`POST /api/analyze-video`), status (`GET /api/job-status/:jobId`), chat (`POST /api/chat/stream`) and conversation (`GET /api/conversation/:jobId`) send it as `x-attribution`; the server verifies and stores the embedded sub in `video_conversations.auth0_id` / `analysis_history.auth0_id`. Downloads (`<video src>`/`<a href>` cannot carry headers) send the same token as `?attribution=` (`getAuthorizedDownloadUrl`), verified identically. A raw `x-auth0-id` header is never trusted — there is nothing to spoof.

### Identity Boundary (service-to-service, two-faces)

The backend never trusts a client-supplied auth0Id. The Next app is the identity boundary for user-scoped data:

- **Guard** (`server/src/lib/serviceGuard.ts`): an Elysia `onBeforeHandle` plugin applied to `auth.ts`/`org.ts`/`me.ts`. When `SERVICE_TOKEN` is set on the server it requires `x-service-token` to match and `x-verified-auth0-id` to equal the path `:auth0Id` (or `body.sub` for `/api/auth/sync`, or be present for self-scoped `/api/me/*`). Returns 403 otherwise. When `SERVICE_TOKEN` is unset the guard is inert (local dev back-compat) and logs a one-time warning.
- **Proxy** (`web-next/app/api/service/[[...path]]/route.ts`): same-origin handler for identity-bearing routes only (`/api/org/*`, `/api/auth/user/*`, `/api/auth/sync`, `/api/me/*`). Reads the Auth0 session, rejects a verified sub that doesn't match the path resource owner, then injects `x-service-token` + `x-verified-auth0-id` before forwarding. Requires `auth0.getSession()` (401 otherwise).
- **Client routing** (`web-next/lib/api.ts` `IDENTITY_BASE`, `web-next/lib/org.ts`, `web-next/lib/serverData.ts`): client components call the proxy via `lib/api`/`lib/org`; RSC pages call React.cache'd fetchers in `lib/serverData.ts` (which use `lib/api` internally with service headers when called server-side). Middleware (`proxy.ts`) and route handlers keep using raw `auth0`/`lib/api`.
- **Web error mapping** (`web-next/lib/errors.ts`): one rule for every transport — `errorFromResponse()` narrows the any-typed wire body (non-string message/code falls back, `retry_after` must be numeric), 429 → `RATE_LIMITED`, structured engine bodies pass through, `engineError()` shapes engine-layer failures. `apiFetch`, both XHR upload paths, and the chat/SSE streams all funnel through it; no hand literals. Query params go through the shared `qs()` (`lib/api.ts`); form payloads through `pickDefined()` (`lib/org.ts`, `''` → null so cleared fields clear).
- **Web role vocabulary**: one set — `NavRole`/`OrgRole`/`MyOrg['role']` are aliases of `ORG_MEMBER_ROLES` (`lib/members.ts`); `userRoles` (coach/player) is the separate account-level set.
- **Out of scope of the proxy:** capability-token routes (`/api/scan-video`, `/api/scan-progress/:sessionToken`, `/api/analyze-video`, `/api/job-status/:jobId`, `/api/download/:jobId`, `/api/chat/stream`, `/api/conversation/:jobId`) stay browser→backend so video uploads and SSE streams never transit Vercel. Downloads use a next.config rewrite. These routes never trust a raw `auth0_id` — attribution comes from the signed `x-attribution` token minted at `/api/me/attribution/mint` (see §6 Auth0).

### Roles (two-faces)

- **Vocabulary:** `server/src/lib/userRoles.ts` ↔ `web-next/lib/userRoles.ts`; values/order pinned by the `userRolesContract` tests on both sides.
- **Enforcement server-side:** `users.role` CHECK `('coach','player')`; sync logic flips to `player` on email-linked first login.
- **Enforcement client-side:** `app/dashboard/layout.tsx` redirects `role === 'player'` → `/player`; `app/player/page.tsx` redirects coaches → `/dashboard`. Pure enforcement lives in the server guard; the UI gates are UX layer only.

### Player (read-only Hub) Routes (CONFIRMED — `server/src/routes/me.ts`)

Self-scoped — identity is the verified `x-verified-auth0-id` header, never a caller-supplied id.

| Endpoint | Purpose |
|---|---|
| `GET /api/me/profile` | Own user record + linked student + coach auth0_id |
| `GET /api/me/attendance` | Own attendance records + summary |
| `GET /api/me/schedule` | Team schedule (owning coach's org) |
| `GET /api/me/performance` | Own performance trend (analysis + manual points) |
| `GET /api/me/analyses` | Analyses linked to player's student row |
| `GET /api/me/reports` | Reports mentioning the player |
| `GET /api/me/reports/:id` | Single report (must belong to the linked student) |
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
| `GET /api/auth/user/:auth0Id/stats` | Aggregate stats (total, completed, failed, downloads) |
| `GET /api/auth/user/:auth0Id/analyses/:jobId/chat` | Load chat history for analysis (served by `routes/chatHistory.ts`) |
| `POST /api/auth/user/:auth0Id/analyses/:jobId/chat` | Send chat message, get AI reply (served by `routes/chatHistory.ts`) |
| `POST /api/auth/user/:auth0Id/analyses/:jobId/cancel` | Cancel in-progress analysis |
| `DELETE /api/auth/user/:auth0Id/analyses/:jobId` | Delete analysis |

`auth.ts` is itself a composer: `serviceGuard` (`:31`), mounting `findingsReadRoutes` (`:144`), `clipsRoute` (`:145`), `findingsReviewRoutes` (`:177`), and `chatHistoryRoute` (`:253`).

Removed 2026-09-24 (dead routes): `GET …/analyses/:jobId/stages` (orphaned `getAnalysisStages`/`AnalysisStageEntry` dropped with it) and `GET /api/org/:auth0Id/teams/:teamId` (+ dead web `getTeam` in `web-next/lib/teams.ts`). Server `POST /api/chat` (non-streaming) removed the same day — see §5 Flow 4.

### Session Tokens (CONFIRMED)

- **Generation:** `engine/api/scan.py:248` — UUID4 on scan (unknown token starts a new session)
- **Storage:** In-memory dict (`engine/sessions.py:24-25`) with threading lock
- **TTL:** 2 hours (`engine/sessions.py:18` `SESSION_TTL = 7200`), max 10 sessions (`engine/sessions.py:19` `MAX_SESSIONS`)
- **Validation:** `engine/api/analyze.py:36` — resolves session + angle video key; missing session → 404 `SESSION_EXPIRED`

### CORS (CONFIRMED)

- **Server:** `server/src/index.ts:98-103` — allows `FRONTEND_URL` origin
- **Engine:** `engine/main.py:118-125` — allows `SERVER_URL` origin

---

## 7. External Dependencies & Integrations

### Google Gemini API (CONFIRMED)

- **Client:** `engine/core/gemini_client.py` — `google-genai` SDK
- **Key env:** `GEMINI_API_KEY` (required, `engine/main.py:39` env guard)
- **Model:** `gemini-2.5-flash` — used by the engine; stored as `DEFAULT_MODEL` in `server/src/types/index.ts` and sent by the frontend in `web-next/lib/api.ts`
- **Usage:** Video analysis with structured JSON output
- **Timeout:** 12 minutes per job (`server/src/lib/engine.ts:251-252` — `withTimeout(…, 12 * 60 * 1000)`, invoked by the worker at `queue.ts:307`); the engine
  analysis Gemini call has its own 10-minute deadline
  (`GEMINI_ANALYSIS_TIMEOUT_S`, retryable `GEMINI_TIMEOUT`); conversational
  calls cap at 100s (`CHAT_GEMINI_TIMEOUT_S`), with SSE comment heartbeats
  on `/chat/stream` during token gaps.

### Upstash Redis (CONFIRMED)

- **Engine:** `engine/core/jobs.py:10-17` — REST client (`upstash-redis` Python)
- **Server:** `server/src/lib/redis.ts:6-48` — ioredis only (TCP; `rediss://` URL derived from the Upstash REST creds)
- **Queue:** `server/src/lib/queue.ts` — TCP connection (`ioredis`) for BullMQ, using the ONE URL derivation exported by `lib/redis.ts` (`getRedisConnectionUrl()` / `isLocalRedis()` — queue.ts's divergent localhost-TLS derivation is deleted); built by `startQueueInfrastructure()` called from `src/index.ts`, never as an import side effect (`new Queue` inside)
- **Env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_IOREDIS_URL`

### Supabase PostgreSQL (CONFIRMED)

- **Client:** `server/src/lib/historyStore.ts` — Bun's `SQL` client
- **Env var:** `DATABASE_URL`
- **Tables:** `video_conversations`, `analysis_history`, `users`, `chat_messages` plus all org tables (`students`, `attendance`, `schedule_events`, `reports`, `performance_metrics`, `teams`, `team_memberships`, `org_members`, `org_invites`, `audit_logs`, `findings`, `clips`, `seasons`, `matches`, …) — all auto-created in `ensureInitialized` on first use
- **Status:** Optional — graceful degradation if not configured (`historyStore.ts:36-40`, `withHistoryStore` returns `null`)

### FFmpeg (CONFIRMED)

- **Usage:** Video normalization (`engine/core/video_io.py:99` `preprocess_video_ffmpeg`, called from `analyzer.py:581`) and keyframe extraction (`video_io.py:145` — every 3s, max 30)
- **Installed in:** `engine/Dockerfile:14` — `apt-get install ffmpeg`

### MediaPipe (CONFIRMED)

- **Usage:** Pose detection (`engine/core/pose_backend.py`), player detection (`engine/core/detector.py`)
- **Two backends:** `mediapipe.tasks.python.vision.PoseLandmarker` (preferred) or `mp.solutions.pose` (fallback)
- **Config:** `model_complexity=0`, `num_poses=4` (memory optimization)

---

## 8. Infrastructure & Deployment

### Docker (CONFIRMED)

**Engine** (`engine/Dockerfile`):
- Base: `python:3.11-slim`
- Exposes: 8001
- Worker: Single uvicorn worker (`--workers 1`)
- Health check: HTTP `/health` every 30s, 60s start period

**Server** (`server/Dockerfile`):
- Base: `oven/bun:1`
- Exposes: 8000
- Health check: HTTP `/health` every 30s, 15s start period

**Compose** (`docker-compose.yml`):
- Engine + Server with health check dependency
- Shared volume: `engine_tmp` for video storage

### Render Deployment (CONFIRMED — `render.yaml`)

- Engine: Free tier web service, Dockerfile build from GitHub repo (`runtime: docker`, `rootDir: engine`)
- Server: Free tier web service, Dockerfile build from GitHub repo (`runtime: docker`, `rootDir: server`)
- Env vars synced from Render dashboard (secrets)

### Vercel Deployment (CONFIRMED — `web-next/vercel.json`)

- Framework: Next.js
- Build: `next build`
- Output: `.next`
- Env: `NEXT_PUBLIC_API_URL` from server service

### Keep-Alive (CONFIRMED)

- **GitHub Actions cron:** `.github/workflows/keepalive.yml` — `*/9 * * * *` pings `GET /health` every 9 minutes (repo secret `SERVER_URL`; keeps the free-tier Render server + in-process worker warm)
- **Frontend:** `web-next/lib/usePipeline.ts:57-61` — pings server `/health` on mount, then every 8 minutes
- **No in-process server pinger** — there is no keep-alive loop in `server/src/lib/queue.ts`

### Graceful Shutdown (CONFIRMED — `server/src/lib/queue.ts` start/stop infrastructure)

- Queue infra is LAZY: importing `queue.ts` connects nothing; `src/index.ts` calls `startQueueInfrastructure()` first (queues, workers, stuck-job recovery + retention timers, and the SIGTERM/SIGINT handlers all registered there, exactly once)
- `stopQueueInfrastructure()` (called from the signal handler) stops the retention/recovery timers, then closes: worker → queue → QueueEvents → Redis connection → Supabase SQL; signal handlers are de-registered
- `onQueueInfrastructureReady(...)` fans out once to attach-once consumers (`lib/notifications.ts` binds its QueueEvents listeners there); queue instances are `export let` — `null` until start
- 10 second timeout before force exit
- Engine: cleans up orphaned files on shutdown (`engine/main.py` lifespan sweep)

Retention scheduling lives in `lib/retention.ts` (`startRetentionSweep`/`stopRetentionSweep` — daily interval + first run 60s after start, same cadence as when it was inlined in queue.ts), started from `startQueueInfrastructure()` under the Redis-availability gate.

---

## 9. Key Architectural Decisions & Trade-offs

### Local Storage Default, S3 Opt-In (CONFIRMED)

- `engine/core/storage.py:46-51` — `is_local_backend()` reads `STORAGE_BACKEND` (default `local` → `LOCAL_STORAGE_DIR`, `engine/.env.sample:5-12`)
- S3-compatible backend shipped (`boto3`): presigned upload `storage.py:179-192`, presigned download `:195-201` — browser direct-to-storage via `POST /upload-intent` (`engine/api/scan.py:303`) / `POST /api/scan-intent` (`server/src/routes/scan.ts:169`); S3 downloads 302 to a presigned GET (`engine/api/jobs.py:102-106`)
- **Trade-off:** Local default keeps free-tier deploys simple; `STORAGE_BACKEND=s3` + `S3_*` gives shared storage without a shared filesystem

### Synchronous Engine Analysis (CONFIRMED)

- `engine/api/analyze.py:65,128-135` — `run_analysis()` called synchronously in `/analyze` (thread pool; BullMQ worker waits for the response)
- BullMQ worker waits for response (`server/src/lib/queue.ts:307` → `engine.ts` `analyzeVideo`)
- **Trade-off:** Simpler error handling, but single job at a time per engine instance

### In-Memory Sessions (CONFIRMED)

- `engine/sessions.py:24-25` — Python dict with threading lock
- **Trade-off:** Fast, but sessions lost on restart, no horizontal scaling

### Two Redis Clients (CONFIRMED)

- Server is ioredis-only: ONE derivation — `getRedisConnectionUrl()` / `isLocalRedis()` in `server/src/lib/redis.ts` — serves both the module client and queue.ts's BullMQ connection (the divergent queue-side localhost-TLS derivation was deleted; a single `rediss://default` literal remains, in redis.ts); no `@upstash/redis` dependency remains
- Engine keeps the Upstash REST client (`upstash-redis` Python): `engine/core/jobs.py:10`, `engine/core/cache.py:9`
- **Trade-off:** BullMQ needs a TCP connection so the server speaks Redis protocol end-to-end; the engine's stateless FastAPI workers use REST

### Frame Caching (CONFIRMED)

- `engine/core/video_io.py:145-190` — `extract_keyframes()` also returns a `frame_cache` of decoded frames; wired in at `analyzer.py:588`
- Reused for detection + motion scoring run in parallel (`analyzer.py:600-612`)
- **Trade-off:** Higher memory usage, but avoids ~60 redundant VideoCapture open/seek/read cycles

### Rate Limiting with Memory Fallback (CONFIRMED)

- `server/src/lib/ratelimit.ts:55-68` — Redis-backed with in-memory fallback
- **Trade-off:** Rate limits lost on restart when using memory fallback, but service stays available

### Statusless vs Stamped Engine Errors (server, CONFIRMED)

- The engine owns code → HTTP status; `throwNonOk` stamps the status the engine actually answered with onto the thrown `CoachAIError.status` — a server-internal field, stripped from every response body by `errorBody()`, so the wire stays the canonical 4-field `CoachAIError`.
- The stamp is the discriminator between "**the engine answered no**" (stamped → posture helpers `enginePassthroughStatus`/`chatEngineStatus` map it: scan/download pass through, chat 4xx-pass/≥500→502) and "**the engine never answered**" (statusless → connectivity posture: 503 `ENGINE_UNAVAILABLE` pass-through, or chat's keyword fallback).
- **Trade-off:** one internal field instead of per-route code→status hand-maps — routes encode *posture*, never code tables; the cost is that `status` must never leak onto the wire (enforced by `errorBody` + parity tests).

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

- Cross-cutting formatting/parsing lives in pure modules with unit tests: `lib/csv.ts` `toCSVString` (OWASP formula-injection escaping), `lib/analysis.ts` `analysisScore`/`getShotEvents`, `lib/date.ts` `scheduleMonthWindow`.
- Web test suite: 201 tests / 19 files; server 360 pass / 34 files (`bun test`, 3 notification DB-integration tests skip unless `DATABASE_URL` is reachable — see §10 Tech Debt); both re-confirmed 2026-09-24.
- **Trade-off:** a thin seam layer over engine-shaped JSON so the app parses defensively without scattering null-guards through components.

---

## 10. Known Gaps, Tech Debt, and Contradictions

### Dead Code (files still present)

None. The last two orphans — `engine/core/baseline.py` and `web-next/components/InlineRename.tsx` — were **deleted** (2026-09-17).

**Not dead (CLI-only, not part of the API pipeline):** `engine/cli/gemini.py`, `engine/cli/chunker.py`, and `engine/cli/player_detector.py` (moved from `core/` on 2026-09-23) plus `engine/cli/main.py`, `frame_selector.py`, `analyze_session.py` are the engine CLI's workload; `chunker` additionally has a dedicated pytest file (`tests/test_chunker.py`, which imports `cli.chunker`). `engine/core/player_tracker.py` is likewise CLI-only (imported by `cli/frame_selector.py`). They live, they are tested, and only the API pipeline is unaware of them.

### Removed Dead Code (since last verification)

Previously documented as dead and since **deleted** from the repo — `pipeline.py`, `connection_pool.py`, `compress.py`, `quality.py`, `analysis_validator.py`, `overlay.py`, `utils.py` (plus the `register_job_input` no-op stub). Not present in `engine/core/` anymore.

Also deleted 2026-09-17: `engine/core/baseline.py` (sport baseline models, never imported) and `web-next/components/InlineRename.tsx` (never imported).

Also deleted 2026-09-23: `engine/core/renderer.py::_sport_emoji` (zero call sites; its emoji map had diverged from the canonical `SPORT_EMOJIS` in `core/sport_config.py`).

Also deleted 2026-09-24 (routing sync): `GET /api/auth/user/:auth0Id/analyses/:jobId/stages` + `getAnalysisStages`/`AnalysisStageEntry`, server `POST /api/chat` (non-streaming — web only used `/api/chat/stream`), `GET /api/org/:auth0Id/teams/:teamId` + dead web `getTeam`, the dead `system_prompt` field + `buildChatSystemPrompt`, and the per-route status maps `scanErrorStatus`/`engineHttpStatus`/2× `engineError`/download's 3-branch map/chat's hand-maps.

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
9. ~~Session/scan-progress memory growth in `engine/main.py`~~ — sessions already cap at `MAX_SESSIONS` with every-300s TTL eviction; the unbounded path was the **`scan_progress` dict**, which was never pruned. Added `evict_old_scan_progress()` (only reachable fix) — stale entries are dropped by the 2h TTL; completed entries are retained for only 5 min (`COMPLETE_SCAN_PROGRESS_RETENTION`). `started_at` is stamped on every entry.
10. ~~Two Redis libraries in `server/`~~ — redis is ioredis-only now. `server/src/lib/redis.ts` derives a `rediss://` URL from `UPSTASH_REDIS_REST_URL` + `_TOKEN` (same derivation as `queue.ts`, already proven in prod by BullMQ) or uses the local URL; the Upstash REST branch and both `@upstash/redis` and `@upstash/ratelimit` dependencies are gone. *(2026-09-24 follow-up: that derivation is now the ONLY one — queue.ts imports `getRedisConnectionUrl()`/`isLocalRedis()` from redis.ts; see §9 Two Redis Clients.)*
11. ~~`lib/notifications.ts` tsc errors~~ — `DashboardAnalysis` now carries `auth0_id` (matches the `analysis_history` row shape); `orgValidate.ts` status-set typed as `ReadonlySet<string>` (mirrors `routes/org.ts`); lint fixes in the notifications file.

### Resolved (fixed 2026-09-23)

12. ~~`server/src/lib/orgData.ts` god-module (1,737 lines)~~ — split into `lib/org/{students,attendance,schedule,reports,performance,wellness,plans,compete,objectives,overview}.ts` (one module per subdomain); `orgData.ts` is now a 103-line named-re-export barrel, so no consumer import paths changed. Billing/subscription reads stayed in `lib/analyses.ts` (`getOrgTier`, usage ledger).
13. ~~Schema owned in three places (`ensureSchema` in orgMembers/teams/invites), duplicated `UUID_RE` literals, ~15 hand-rolled 429 bodies, duplicate BullMQ wiring~~ — all DDL now lives solely in `historyStore.ensureInitialized` (`ensureSchema` helpers removed); one `UUID_RE` in `lib/uuid.ts`; every rate-limit rejection goes through `rateLimited()` in `lib/ratelimit.ts`; single queue/worker wiring exported from `lib/queue.ts` (`notifications.ts` consumes `queueEvents` from it).
14. ~~`routes/auth.ts` monolith~~ — now a composer that mounts split-out `routes/findings.ts`, `routes/clips.ts`, and `routes/chatHistory.ts`; the keyword fallback responder moved to `lib/aiResponse.ts`.
15. ~~`engine/main.py` monolith (1,459 lines)~~ — thin app (221 lines: env guard, Sentry, CORS, middlewares, exception handlers, lifespan, 8 router includes) over a new `engine/api/` package (`scan`, `analyze`, `chat`, `report`, `jobs` (status/fail + download), `health`, `sports`, `errors`); session store + eviction extracted to `engine/sessions.py`; inline Gemini chat/report calls extracted to `core/chat_client.py` + `core/report_client.py`; CLI-only modules moved `core/`→`cli/` (`gemini.py`, `chunker.py`, `player_detector.py`) with import updates incl. `tests/test_chunker.py`; sport vocabulary centralized in `core/sport_config.py` (`SPORTS`/`SPORT_EMOJIS`/`sport_emoji()`/`sport_pack_ids()`), consumed by `prompt.py`, `validator.py`, and `cli/main.py`.
16. ~~Dual dependency manifests for the engine~~ — `engine/requirements.txt` is the single runtime manifest; `pyproject.toml` carries tooling config only, with a pointer comment. Also removed the dead `_sport_emoji` map from `core/renderer.py` (see Removed Dead Code).

### Resolved (fixed 2026-09-24)

Six architecture candidates + a routing sync landed together (all uncommitted as of this doc pass; baselines re-confirmed: server `bun test` 333/33, engine `pytest -q` 220, web `vitest run` 146/16, tsc/lint/prettier/ruff clean).

17. ~~**Candidate 1 — history-store sprawl:** ~112 per-callback `await ensureInitialized()` lines across ~21 lib files, `withHistoryStoreOrThrow as withHistoryStore` aliases (14 files), per-site no-DB `?? default` degradation, copied child-table deletes in retention paths, notifications DDL outside `ensureInitialized`~~ — the twin wrappers now share one private `runWithHistoryStore(fn, throwOnFailure)` that initializes before the callback (callbacks never re-run init); zero aliases remain; `orDisabledDefault(value, fallback)` is the single no-DB degradation policy (18 sites); child-deletes dedupe over `ANALYSIS_CHILD_TABLES`/`deleteAnalysisChildren` (`lib/analyses.ts`); notifications DDL moved into `ensureInitialized` — `rg -rniE "create table|create index" server/src` hits only `historyStore.ts` (sole DDL owner, literally). New `tests/historyStore.test.ts` (8).
18. ~~**Candidate 4 — identity + admission:** self-scope header checks hand-rolled per handler; quota → tier → priority → usage inlined twice (analyze + me/analyze)~~ — `requireVerifiedSelf`/`missingVerifiedSelf` (`lib/caller.ts`; 18 sites: me.ts 13+1, notifications.ts 4 — predicate byte-identical, still handler-level; share.ts/auth.ts keep their verified-different idiom) and `admitAnalysis` (`lib/analysisAdmission.ts`: quota → tier → priority → usage in that order; `analysisPriority(base, tier)` pure; analyze base 5 → 5/10/15, me base 10 → 10/15/20). New `tests/{identityGuards,analysisAdmission}.test.ts` (18+7).
19. ~~**Candidates 2 + 6 — queue/redis:** two Redis URL derivations (queue's divergent localhost-TLS variant), retry predicates re-literalized at call sites, worker wiring built inline, retention sweep inlined in queue.ts, eager import-time queue start~~ — ONE derivation `getRedisConnectionUrl()`/`isLocalRedis()` (`lib/redis.ts`; one `rediss://default` literal remains), `classifyFailure()` the single retry predicate (notifications.test.ts imports it), `createWorkerProcessor()` the shared worker template, retention moved to `lib/retention.ts` (`startRetentionSweep`/`stopRetentionSweep`, same 24h + 60s cadence), `buildFailedAnalysisStatus()` consolidates failed payloads, and LAZY wiring: importing queue.ts has no side effects, `index.ts` calls `startQueueInfrastructure()` first / `stopQueueInfrastructure()` on shutdown, `onQueueInfrastructureReady(...)` attaches notifications once, instances are `export let` null-until-start. Engine `jobs.py`/`cache.py` keep their (identical) env derivations — hypothetical seam, deliberately untouched. New `tests/{queue,redisUrl}.test.ts` (17).
20. ~~**Candidate 3 — chat flow:** no shared chat-store seam, chatHistory's raw engine fetch without requestId, dead `system_prompt`/`buildChatSystemPrompt`, unbuffered SSE split that dropped `data:` lines straddling chunk boundaries~~ — `Transcript` interface (`lib/transcript.ts`: `playerTranscript` Redis / `dashboardTranscript` Postgres — seam only, NO store merge), `askEngineChat(payload, requestId)` (`lib/engine.ts`; all server→engine calls now pass requestId), dead prompt deleted, buffered `lib/sse.ts` (`createSseLineBuffer`/`parseSseDataEvents`) replaces chat.ts's unbuffered split. ONE behavior change: engine HTTP error responses on the auth-scoped chat surface as CoachAIError instead of silently falling back to the keyword responder — connectivity loss still falls back to `generateSimpleResponse` (pinned by test). New engine `tests/test_chat_route.py` (6).
21. ~~**Candidate 5 — error/status registry drift:** per-route hand-maps (`scanErrorStatus`, `engineHttpStatus`, 2× `engineError`, download's 3-branch map, chat's 2× hand-maps) disagreeing with the engine registry~~ — the engine owns code → status (`STATUS_BY_CODE`) and code → retryable (`RETRYABLE_BY_CODE`; unregistered codes fall back `status >= 500`); `throwNonOk` stamps `CoachAIError.status`; routes use posture helpers `enginePassthroughStatus`/`chatEngineStatus` + `errorBody` (strips the stamp → canonical 4-field wire body). **422 drift retired** (deliberate fixes): scan NO_PLAYERS 422→400, VIDEO_DECODE 422→400 (pipeline errors via `STATUS_BY_CODE`; the scan upload content-type pre-check at `engine/api/scan.py:42-46` still answers an explicit 422 directly — engine-owned, untouched by the parity pass), GEMINI_QUOTA 500→429, GEMINI_TIMEOUT 500→504, scan JOB_NOT_FOUND 500→404, download engine 5xx passes through (was misreported 404), download messages/codes engine-owned (layer server→engine), chat layer server→engine + wire retryable. Engine side: one materialized change — GEMINI_QUOTA_EXCEEDED@429 retryable false→true. Parity tests: server `tests/errors.test.ts` (32), engine `test_errors.py` (+4), new `engine/tests/test_api_errors.py`.
22. ~~**Routing sync:** `JOB_NOT_FOUND` `retryable` varied by path (the 200-expired poll said `true`); three dead routes still registered~~ — `retryable: false` on ALL paths (both directions tested; generic default untouched); removed `GET …/stages`, server `POST /api/chat` non-streaming, `GET /api/org/:auth0Id/teams/:teamId` (+ dead web `getTeam`). Route table 121→118 (raw-registration counting), zero unconsumed routes; `/health/deep` KEPT (ops-only — comment corrected: frontend only pings `/health`); kept-by-design: DELETE share-tokens (tested), `GET /api/me/reports/:id` + org performance (smoke). Prior audit: 0 broken web→server calls.

### Missing Features

**CI/CD is active** — `.github/workflows/ci.yml` (tests), `deploy.yml` (Render deploys), `keepalive.yml` (GitHub Actions cron).

### Technical Debt

1. **Notifications DB integration tests are env-gated** — `server/tests/notifications.test.ts` keeps three DB-touching tests under `describe.skip` unless `DATABASE_URL` points at a reachable database. Locally, Bun auto-loads `server/.env`, so those tests run against the live Neon DB (they hang only if the DB is unreachable). CI without `DATABASE_URL` stays green.

---

## 11. How to Verify This Document

| Claim | Verification |
|-------|--------------|
| Next.js ^16.2.12 | `web-next/package.json:15` |
| Elysia ^1.4.30 | `server/package.json:19` |
| FastAPI 0.141.1 | `engine/requirements.txt:1` |
| google-genai 2.15.0 | `engine/requirements.txt:4` |
| BullMQ concurrency: 1 | `server/src/lib/queue.ts:462-465` ("BullMQ manages concurrency…", `new Worker`, `WORKER_CONCURRENCY` env) |
| Worker timeout: 12 min | `server/src/lib/engine.ts:251-252` (`analyzeVideo` `withTimeout(…, 12 * 60 * 1000)`; worker call at `queue.ts:307`) |
| Stuck job recovery: 13 min | `server/src/lib/queue.ts:413` (`recoverStuckJobs` at :410, `STUCK_MS = 13 * 60 * 1000`) |
| Session TTL: 2 hours | `engine/sessions.py:18` (`SESSION_TTL = 7200`) |
| Cache TTL: 24 hours | `engine/core/cache.py:25` |
| Rate limit: scan 10/min | `server/src/lib/ratelimit.ts:70-72` (`checkScanLimit`, `SCAN_RATE_LIMIT`) |
| Rate limit: analysis 5/hour | `server/src/lib/ratelimit.ts:75-77` (`checkAnalysisLimit`, `ANALYSIS_RATE_LIMIT`) |
| Local storage default, S3 optional | `engine/core/storage.py:46-53` (`is_local_backend()`; `STORAGE_BACKEND=s3` switches to the bucket + presigned URLs) |
| Pipeline states | `engine/core/jobs.py` |
| Test suite: 225 tests pass (CONFIRMED 2026-09-24) | `cd engine && ./.venv/bin/python -m pytest tests -q` |
| Test suite: 360 pass / 34 files (CONFIRMED 2026-09-25) | `cd server && bun test` (3 notification DB-integration tests skip unless `DATABASE_URL` reachable) |
| Test suite: 201 tests / 19 files (CONFIRMED 2026-09-25) | `cd web-next && npx vitest run` |
| Sole DDL owner | `rg -rniE "create table|create index" server/src` → only `lib/historyStore.ts` |
| Error/status parity (all three layers) | `server/tests/errors.test.ts` (32) vs `engine/tests/test_errors.py` + `engine/tests/test_api_errors.py` (registry `STATUS_BY_CODE`/`RETRYABLE_BY_CODE`) |
| New contract tests (2026-09-24 candidates + logging) | `server/tests/{historyStore,identityGuards,analysisAdmission,queue,redisUrl,sse,transcript,chatHistoryEngine,logger}.test.ts`, `engine/tests/test_chat_route.py` |
| No dead / unconsumed routes | `rg "stages" server/src/routes` and `rg "'/api/chat'" server/src/routes` return nothing; `routes/chat.ts` serves only `/api/chat/stream` + `/api/conversation/:jobId` |
| JOB_NOT_FOUND retryable: false on all paths | `server/tests` status/chat/download tests pin both the 404 and 200-expired answers |
| Dead code deleted: baseline.py, InlineRename.tsx, renderer._sport_emoji | `git rm`; `rg "baseline" engine/core engine/main.py`, `rg "_sport_emoji" engine/`, and `rg "InlineRename" web-next/` return nothing |
| CLI-only modules kept (chunker/gemini/player_detector under cli/) | imported by `engine/cli/`; `tests/test_chunker.py` imports `cli.chunker` |
| scan_progress pruned | `engine/sessions.py`: `SCAN_PROGRESS_TTL` / `COMPLETE_SCAN_PROGRESS_RETENTION`, `evict_old_scan_progress()` called from `evict_old_sessions()` |
| HOG singleton | `engine/core/detection_utils.py:25` module-level `_HOG_DESCRIPTOR` used by `detector.py` + `analyzer.py` |
| Redis is ioredis-only | `server/src/lib/redis.ts`; `rg "@upstash" server/package.json` returns nothing |
| Auth0 auth (beta gate removed) | `grep -rn "BETA_CODES" server/src/` returns nothing |
| Keep-alive: 9 min (external cron only) | `.github/workflows/keepalive.yml` → `GET /health` |
| Frontend keep-alive ping: 8 min | `web-next/lib/usePipeline.ts:59-61` |
| Session via React.cache | `web-next/lib/session.ts` wraps `auth0.getSession` in `React.cache` |
| Server fetchers via React.cache | `web-next/lib/serverData.ts` wraps `lib/api`/`lib/org` fetchers |
| recharts isolated in own chunk | `components/org/PerformanceChart.tsx` imported via `next/dynamic` (`ssr: false`) |
| content-visibility on list rows | `rg -l "content-visibility" web-next/components/org web-next/app/dashboard` |
| CSV formula injection escaped | `web-next/lib/csv.ts` `toCSVString` prefixes `= + - @ tab CR`-leading strings |

---

*Last verified: 2026-09-24 (documentation-sync pass after six architecture candidates + a routing sync landed: historyStore wrapper-owned init + `orDisabledDefault`, `requireVerifiedSelf`/`admitAnalysis`, lazy queue wiring + single Redis URL derivation + `lib/retention.ts`, chat `Transcript` seam + `askEngineChat` + buffered `lib/sse.ts` + dead `system_prompt` removed, engine-owned error/status/retryable registry with server posture helpers, JOB_NOT_FOUND `retryable: false` everywhere, dead routes removed (`…/stages`, server `POST /api/chat`, `GET /teams/:teamId`), statusless-vs-stamped decision added §9, Resolved entries 17–22 §10; baselines CONFIRMED: server 333/33, engine 220, web 146/16, tsc/lint/prettier/ruff clean. Later same-day hardening (counts now server 360/34, engine 225, web 185/18): winston logging seam + access logs, logged degradation fallbacks, classifyFailure terminal-event fix, striped engine job locks, code-based historyStore reconnect predicate, dead-export sweeps, live-DB test budgets)*
