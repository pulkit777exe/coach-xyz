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
| Elysia | ^1.4.29 | `server/package.json:18` |
| BullMQ | ^5.81.3 | `server/package.json:17` |
| ioredis | ^5.11.1 | `server/package.json:19` |
| @sentry/node | ^10.69.0 | `server/package.json:14` |
| TypeScript | ^5.9.3 | `server/package.json:24` |

### Engine (`engine/`)
| Technology | Version | Source |
|------------|---------|--------|
| Python | 3.11 | `engine/Dockerfile:1` |
| FastAPI | 0.141.1 | `engine/requirements.txt:1` |
| uvicorn | 0.52.0 | `engine/requirements.txt:2` |
| google-genai | 2.15.0 | `engine/requirements.txt:3` |
| httpx | 0.28.1 | `engine/requirements.txt:4` |
| mediapipe | 1.0.0 | `engine/requirements.txt:5` |
| opencv-python-headless | 4.13.0.92 | `engine/requirements.txt:7` |
| orjson | 3.11.9 | `engine/requirements.txt:9` |
| sentry-sdk | 2.66.1 | `engine/requirements.txt:14` |
| upstash-redis | 1.7.0 | `engine/requirements.txt:15` |

### Infrastructure
| Component | Technology | Source |
|-----------|------------|--------|
| Queue | BullMQ + Redis | `server/src/lib/queue.ts:1` |
| Job Storage | Upstash Redis (REST) | `engine/core/jobs.py:10-17` |
| Server Redis | @upstash/redis (REST) or ioredis (TCP) | `server/src/lib/redis.ts:6-48` |
| Database | Supabase PostgreSQL | `server/src/lib/supabaseHistory.ts:43-48` |
| Video Storage | Local filesystem | `engine/core/storage.py:25-26` |
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
│   │   ├── InlineRename.tsx          # Inline rename (unused — not imported)
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
│   │   ├── scan.ts            # POST /api/scan-video — upload + player detection
│   │   ├── analyze.ts         # POST /api/analyze-video — enqueue analysis job
│   │   ├── status.ts          # GET /api/job-status/:jobId — poll progress
│   │   ├── download.ts        # GET /api/download/:jobId — stream result video
│   │   ├── chat.ts            # POST /api/chat — V2 chat proxy to engine
│   │   ├── email.ts           # POST /api/email/:auth0Id/{invite|report|attendance} (Resend, guarded)
│   │   ├── auth.ts            # /api/auth/* — user sync, analyses, chat history (guarded)
│   │   ├── org.ts             # /api/org/:auth0Id/* — coach org CRUD (guarded)
│   │   ├── me.ts              # /api/me/* — player read-only hub (guarded, self-scoped) + mint endpoint
│   │   └── health.ts          # GET /health, /health/deep
│   ├── src/lib/
│   │   ├── queue.ts           # BullMQ queue + worker + shutdown
│   │   ├── redis.ts           # Redis client (Upstash REST or local ioredis)
│   │   ├── jobs.ts            # Server-side job mapping (server_job_id → engine_job_id)
│   │   ├── engine.ts          # HTTP client to engine (/scan, /analyze, /status, /download)
│   │   ├── ratelimit.ts       # IP-based rate limiting (scan: 10/min, analysis: 5/hr)
│   │   ├── attribution.ts     # Mint/verify signed attribution tokens (sub.exp.HMAC, SERVICE_TOKEN)
│   │   ├── serviceGuard.ts    # SERVICE_TOKEN + verified-auth0-id identity guard
│   │   ├── orgEnums.ts        # Shared org vocab (values/order contract w/ web lib/org.ts)
│   │   ├── orgData.ts         # Student/attendance/schedule/reports/performance queries
│   │   ├── userRoles.ts       # coach/player role vocab (contract w/ web lib/userRoles.ts)
│   │   ├── supabaseHistory.ts # PostgreSQL history + user + chat persistence
│   │   ├── conversation.ts    # Redis-backed conversation storage (V2)
│   │   └── errors.ts          # Error types and builders
│   └── src/types/index.ts     # Shared API types
│
├── engine/                    # Video analysis engine (Python + FastAPI)
│   ├── main.py                # FastAPI app, routes, session management
│   ├── core/
│   │   ├── analyzer.py        # Main analysis pipeline (run_analysis)
│   │   ├── detector.py        # Player detection (HOG + MediaPipe pose)
│   │   ├── player_detector.py # Alternate player detection path
│   │   ├── renderer.py        # Video annotation (HUD, landmarks, summary)
│   │   ├── gemini.py          # Gemini API client (legacy entry point)
│   │   ├── gemini_client.py   # Gemini call + normalize (active)
│   │   ├── gemini_common.py   # Shared Gemini helpers
│   │   ├── chat_prompt.py     # V2 chat prompt builder
│   │   ├── prompt.py          # Analysis system prompt for Gemini
│   │   ├── validator.py       # Gemini output schema validation
│   │   ├── jobs.py            # Engine-side job state machine (Redis)
│   │   ├── cache.py           # Video hash + Redis caching
│   │   ├── dedup.py           # Request deduplication
│   │   ├── storage.py         # Local file storage
│   │   ├── video_io.py        # FFmpeg preprocessing + keyframe extraction
│   │   ├── tracking.py        # Player track building + motion scoring
│   │   ├── pose_backend.py    # MediaPipe pose detection abstraction
│   │   ├── detection_utils.py # Shared detection helpers
│   │   ├── stats.py           # Shot-event stat validation + correction
│   │   ├── baseline.py        # Sport baseline metrics
│   │   ├── injury_risk.py     # Injury-risk indicator computation
│   │   ├── config.py          # Engine configuration constants
│   │   ├── logging_config.py  # Structured logging setup
│   │   ├── errors.py          # Error types hierarchy
│   │   ├── player_tracker.py  # Player tracking (CLI only — engine/cli/frame_selector.py)
│   │   ├── chunker.py         # Video chunking (CLI only)
│   │   └── baseline.py        # Sport baseline metrics (dead code — unused by API pipeline)
│   ├── tests/                 # pytest suite (103 tests in test_state_machine/test_errors/test_analysis_contract/test_storage/test_chunker/test_config/test_dedup/test_validator)
│   └── requirements.txt       # Python dependencies
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

### Supabase Tables (CONFIRMED — `server/src/lib/supabaseHistory.ts`)

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
- Fields (in `server/src/lib/orgData.ts`): full_name, email, phone, sport, position, jersey_number, date_of_birth, gender, guardian_name, guardian_phone, notes, status (CHECK: STUDENT_STATUSES), joined_on, `account_auth0_id` (player login link, indexed), created_at, updated_at
- Purpose: the coach's roster. A player's account is linked to their student row by email on first player login (`account_auth0_id` set, user `role` → 'player').

**attendance** / **schedule_events** / **reports** / **performance_metrics** (org)
- All scoped by owning coach `auth0_id`; attendance/performance also reference `student_id`. Player read-only views query these with the coach scope + the linked student. (CHECK constraints pin the shared vocab in `server/src/lib/orgEnums.ts`, mirrored contractually in `web-next/lib/org.ts`.)
- **Uniqueness is org-scoped** (migrated 2026-09-21): `attendance` has a `UNIQUE (auth0_id, student_id, session_date)` constraint (`attendance_auth0_student_session_unique`) and `performance_metrics` a `UNIQUE (auth0_id, student_id, metric_key, measured_at)` (`performance_auth0_student_metric_unique`) — the legacy `UNIQUE (student_id, …)` keys were auto-dropped/migrated idempotently in `ensureInitialized` (`supabaseHistory.ts`), and the upsert `ON CONFLICT` targets in `orgData.ts` match. This stops one org's rows from colliding with another org's same-id student rows.

**chat_messages**
- Primary key: `id` (UUID)
- Fields: server_job_id, auth0_id, role (user/assistant/system), content, timestamp_refs (jsonb), event_refs (jsonb), created_at
- Purpose: Persistent per-analysis chat history (V2 feature)

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

---

## 5. Request / Data Flow

### Flow 1: Video Upload + Scan (CONFIRMED)

```
1. Frontend POST /api/scan-video (FormData with video file)
   → web-next/lib/api.ts:96-104
   → server/src/routes/scan.ts:28

2. Server validates (rate limit, file type, size < 500MB)
   → server/src/routes/scan.ts:30-60

3. Server forwards to Engine POST /scan
   → server/src/lib/engine.ts:42-64 (60s timeout)

4. Engine streams upload to local storage
   → engine/main.py:291-315

5. Engine runs player detection (HOG + MediaPipe)
   → engine/main.py:320-321
   → engine/core/detector.py

6. Engine creates session (in-memory dict)
   → engine/main.py:340-348

7. Engine warms cache for video hash
   → engine/main.py:351-356
   → engine/core/cache.py:77-93

8. Server persists to Supabase + returns session_token
   → server/src/routes/scan.ts:66-78

9. [Optional] Frontend subscribes to scan progress via SSE
   → GET /api/scan-progress/:sessionToken (server/src/routes/scan.ts:115, proxies raw SSE)
   → GET /scan-progress/{session_token} (engine/main.py:526)
```

### Flow 2: Analysis (CONFIRMED)

```
1. Frontend POST /api/analyze-video { session_token, player_index }
   → web-next/lib/api.ts:106-117
   → server/src/routes/analyze.ts:17

2. Server creates server_job_id + engine_job_id
   → server/src/routes/analyze.ts:68-69

3. Server saves job mapping to Redis
   → server/src/routes/analyze.ts:72-79
   → server/src/lib/jobs.ts:15-21

4. Server pre-creates engine job in Redis
   → server/src/routes/analyze.ts:82-100

5. Server enqueues to BullMQ
   → server/src/routes/analyze.ts:107-118
   → server/src/lib/queue.ts:18-28

6. BullMQ worker picks up job (concurrency: 1)
   → server/src/lib/queue.ts:70-106

7. Worker calls Engine POST /analyze (12 min timeout)
   → server/src/lib/queue.ts:76-88

8. Engine runs analysis synchronously
   → engine/main.py:415-432
   → engine/core/analyzer.py:541-684
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

9. Server polls status via Redis (direct read, no HTTP)
   → server/src/routes/status.ts:16
   → server/src/lib/jobs.ts:33-39
```

### Flow 3: Download Result (CONFIRMED)

```
1. Frontend GET /api/download/:jobId
   → web-next/lib/api.ts:123-125
   → server/src/routes/download.ts:8

2. Server looks up engine_job_id from Redis
   → server/src/lib/jobs.ts:23-29

3. Server streams from Engine GET /download/:jobId
   → server/src/lib/engine.ts:118-136 (60s timeout)

4. Engine serves file from local storage
   → engine/main.py:557-579
   → engine/core/storage.py:37-41, 74-83
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

**Auth-scoped chat** (`/api/auth/user/:auth0Id/analyses/:jobId/chat` — GET/POST, server/src/routes/auth.ts:182/201) persists messages to Supabase `chat_messages` and falls back to a keyword-based `generateSimpleResponse` when the engine is down.

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
- **`auth0_id` attribution on capability routes:** capability-token routes can't transit the identity proxy (uploads/SSE), so scan/analyze attribution uses a **signed attestation token** instead of a raw client header. The web app fetches `GET /api/me/attribution/mint` (self-scoped, behind serviceGuard) which returns a short-lived HMAC-SHA256 token binding the **verified session sub** (`sub.exp.exp-hmac`, TTL 10 min, keyed by `SERVICE_TOKEN`, `server/src/lib/attribution.ts`). Browser-direct scan (`POST /api/scan-video`), analyze (`POST /api/analyze-video`), status (`GET /api/job-status/:jobId`), chat (`POST /api/chat`, `/api/chat/stream`) and conversation (`GET /api/conversation/:jobId`) send it as `x-attribution`; the server verifies and stores the embedded sub in `video_conversations.auth0_id` / `analysis_history.auth0_id`. Downloads (`<video src>`/`<a href>` cannot carry headers) send the same token as `?attribution=` (`getAuthorizedDownloadUrl`), verified identically. A raw `x-auth0-id` header is never trusted — there is nothing to spoof.

### Identity Boundary (service-to-service, two-faces)

The backend never trusts a client-supplied auth0Id. The Next app is the identity boundary for user-scoped data:

- **Guard** (`server/src/lib/serviceGuard.ts`): an Elysia `onBeforeHandle` plugin applied to `auth.ts`/`org.ts`/`me.ts`. When `SERVICE_TOKEN` is set on the server it requires `x-service-token` to match and `x-verified-auth0-id` to equal the path `:auth0Id` (or `body.sub` for `/api/auth/sync`, or be present for self-scoped `/api/me/*`). Returns 403 otherwise. When `SERVICE_TOKEN` is unset the guard is inert (local dev back-compat) and logs a one-time warning.
- **Proxy** (`web-next/app/api/service/[[...path]]/route.ts`): same-origin handler for identity-bearing routes only (`/api/org/*`, `/api/auth/user/*`, `/api/auth/sync`, `/api/me/*`). Reads the Auth0 session, rejects a verified sub that doesn't match the path resource owner, then injects `x-service-token` + `x-verified-auth0-id` before forwarding. Requires `auth0.getSession()` (401 otherwise).
- **Client routing** (`web-next/lib/api.ts` `IDENTITY_BASE`, `web-next/lib/org.ts`, `web-next/lib/serverData.ts`): client components call the proxy via `lib/api`/`lib/org`; RSC pages call React.cache'd fetchers in `lib/serverData.ts` (which use `lib/api` internally with service headers when called server-side). Middleware (`proxy.ts`) and route handlers keep using raw `auth0`/`lib/api`.
- **Out of scope of the proxy:** capability-token routes (`/api/scan-video`, `/api/scan-progress/:sessionToken`, `/api/analyze-video`, `/api/job-status/:jobId`, `/api/download/:jobId`, `/api/chat`, `/api/chat/stream`, `/api/conversation/:jobId`) stay browser→backend so video uploads and SSE streams never transit Vercel. Downloads use a next.config rewrite. These routes never trust a raw `auth0_id` — attribution comes from the signed `x-attribution` token minted at `/api/me/attribution/mint` (see §6 Auth0).

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
| `GET /api/auth/user/:auth0Id/analyses/:jobId/chat` | Load chat history for analysis |
| `POST /api/auth/user/:auth0Id/analyses/:jobId/chat` | Send chat message, get AI reply |

### Session Tokens (CONFIRMED)

- **Generation:** `engine/main.py:340` — UUID4 on scan
- **Storage:** In-memory dict (`engine/main.py:57`) with threading lock
- **TTL:** 1 hour (`engine/main.py:25`), max 10 sessions (`engine/main.py:26`)
- **Validation:** `engine/main.py:221-236` — checks session exists and has video_key

### CORS (CONFIRMED)

- **Server:** `server/src/index.ts:52-55` — allows `FRONTEND_URL` origin
- **Engine:** `engine/main.py:99-105` — allows `SERVER_URL` origin

---

## 7. External Dependencies & Integrations

### Google Gemini API (CONFIRMED)

- **Client:** `engine/core/gemini_client.py` — `google-genai` SDK
- **Key env:** `GEMINI_API_KEY` (required, `engine/main.py:29`)
- **Model:** `gemini-2.5-flash` — used by the engine; stored as `DEFAULT_MODEL` in `server/src/types/index.ts` and sent by the frontend in `web-next/lib/api.ts`
- **Usage:** Video analysis with structured JSON output
- **Timeout:** 12 minutes per job (`server/src/lib/queue.ts:86`)

### Upstash Redis (CONFIRMED)

- **Engine:** `engine/core/jobs.py:10-17` — REST client (`upstash-redis` Python)
- **Server:** `server/src/lib/redis.ts:6-48` — REST (`@upstash/redis`) or TCP (`ioredis`)
- **Queue:** `server/src/lib/queue.ts:6-16` — TCP connection (`ioredis`) for BullMQ
- **Env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_IOREDIS_URL`

### Supabase PostgreSQL (CONFIRMED)

- **Client:** `server/src/lib/supabaseHistory.ts` — Bun's `SQL` client
- **Env var:** `DATABASE_URL`
- **Tables:** `video_conversations`, `analysis_history`, `users`, `chat_messages` (all auto-created on startup)
- **Status:** Optional — graceful degradation if not configured (`supabaseHistory.ts:55-61`)

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

- **Server:** `server/src/lib/queue.ts:90-127` — pings `/health` every 10 minutes in production (`KEEPALIVE_INTERVAL`, production only)
- **Frontend:** `web-next/lib/usePipeline.ts:51-57` — pings server `/health` every 8 minutes

### Graceful Shutdown (CONFIRMED — `server/src/lib/queue.ts:369-400`)

- SIGTERM/SIGINT handlers
- Closes: worker → queue → Redis connection → Supabase SQL
- 10 second timeout before force exit
- Engine: cleans up orphaned files on shutdown (`engine/main.py:84-94`)

---

## 9. Key Architectural Decisions & Trade-offs

### Local Storage Only (CONFIRMED)

- `engine/core/storage.py:25-26` — `is_local_backend()` always returns `True`
- No S3/R2 integration — files stored in `/app/tmp/storage/`
- **Trade-off:** Simpler deployment, but no horizontal scaling without shared filesystem

### Synchronous Engine Analysis (CONFIRMED)

- `engine/main.py:415-419` — `run_analysis()` called synchronously in `/analyze`
- BullMQ worker waits for response (`server/src/lib/queue.ts:76-88`)
- **Trade-off:** Simpler error handling, but single job at a time per engine instance

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

- Cross-cutting formatting/parsing lives in pure modules with unit tests: `lib/csv.ts` `toCSVString` (OWASP formula-injection escaping), `lib/analysis.ts` `analysisScore`/`getShotEvents`, `lib/date.ts` `scheduleMonthWindow`.
- Web test suite: 138 tests / 15 files (`vitest run`); server 179 pass / 15 files (`bun test`, 3 notification DB-integration tests skip unless `DATABASE_URL` is reachable — see §10 Tech Debt).
- **Trade-off:** a thin seam layer over engine-shaped JSON so the app parses defensively without scattering null-guards through components.

---

## 10. Known Gaps, Tech Debt, and Contradictions

### Dead Code (files still present)

None. The last two orphans — `engine/core/baseline.py` and `web-next/components/InlineRename.tsx` — were **deleted** (2026-09-17).

**Not dead (CLI-only, not part of the API pipeline):** `engine/core/player_tracker.py` and `engine/core/chunker.py` are the engine CLI's workload (`engine/cli/main.py`, `frame_selector.py`, `analyze_session.py`); `chunker` additionally has a dedicated pytest file (`tests/test_chunker.py`). They live, they are tested, and only the API pipeline is unaware of them.

### Removed Dead Code (since last verification)

Previously documented as dead and since **deleted** from the repo — `pipeline.py`, `connection_pool.py`, `compress.py`, `quality.py`, `analysis_validator.py`, `overlay.py`, `utils.py` (plus the `register_job_input` no-op stub). Not present in `engine/core/` anymore.

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

**CI/CD is active** — `.github/workflows/ci.yml` (tests), `deploy.yml` (Render deploys), `keepalive.yml` (GitHub Actions cron).

### Technical Debt

1. **Notifications DB integration tests are env-gated** — `server/tests/notifications.test.ts` keeps three DB-touching tests under `describe.skip` unless `DATABASE_URL` points at a reachable database. Locally, Bun auto-loads `server/.env`, so those tests run against the live Neon DB (they hang only if the DB is unreachable). CI without `DATABASE_URL` stays green.

---

## 11. How to Verify This Document

| Claim | Verification |
|-------|--------------|
| Next.js ^16.2.12 | `web-next/package.json:15` |
| Elysia ^1.4.29 | `server/package.json:18` |
| FastAPI 0.141.1 | `engine/requirements.txt:1` |
| google-genai 2.15.0 | `engine/requirements.txt:3` |
| BullMQ concurrency: 1 | `server/src/lib/queue.ts:222` |
| Worker timeout: 12 min | `server/src/lib/queue.ts:162` |
| Stuck job recovery: 13 min | `server/src/lib/queue.ts:340` |
| Session TTL: 2 hours | `engine/main.py:45` |
| Cache TTL: 24 hours | `engine/core/cache.py:25` |
| Rate limit: scan 10/min | `server/src/lib/ratelimit.ts:83` |
| Rate limit: analysis 5/hour | `server/src/lib/ratelimit.ts:88` |
| Local storage only | `engine/core/storage.py:24` (`is_local_backend()` always `True`) |
| Pipeline states | `engine/core/jobs.py` |
| Test suite: 103 tests pass | `cd engine && ./.venv/bin/python -m pytest tests -q` |
| Test suite: 179 pass / 15 files | `cd server && bun test` (3 notification DB-integration tests skip unless `DATABASE_URL` reachable) |
| Test suite: 138 tests pass (15 files) | `cd web-next && npx vitest run` |
| Dead code deleted: baseline.py, InlineRename.tsx | `git rm`; `rg "baseline" engine/core engine/main.py` and `rg "InlineRename" web-next/` return nothing |
| player_tracker.py/chunker.py are CLI-only (kept) | imported by `engine/cli/`; `tests/test_chunker.py` exists |
| scan_progress pruned | `engine/main.py`: `SCAN_PROGRESS_TTL` / `COMPLETE_SCAN_PROGRESS_RETENTION`, `_evict_old_scan_progress()` called alongside `_evict_old_sessions()` |
| HOG singleton | `engine/core/detection_utils.py:25` module-level `_HOG_DESCRIPTOR` used by `detector.py` + `analyzer.py` |
| Redis is ioredis-only | `server/src/lib/redis.ts`; `rg "@upstash" server/package.json` returns nothing |
| Auth0 auth (beta gate removed) | `grep -rn "BETA_CODES" server/src/` returns nothing |
| Keep-alive: 9 min (external cron only) | `.github/workflows/keepalive.yml` → `GET /health` |
| Frontend status poll: 8 min | `web-next/lib/usePipeline.ts:80` |
| Session via React.cache | `web-next/lib/session.ts` wraps `auth0.getSession` in `React.cache` |
| Server fetchers via React.cache | `web-next/lib/serverData.ts` wraps `lib/api`/`lib/org` fetchers |
| recharts isolated in own chunk | `components/org/PerformanceChart.tsx` imported via `next/dynamic` (`ssr: false`) |
| content-visibility on list rows | `rg -l "content-visibility" web-next/components/org web-next/app/dashboard` |
| CSV formula injection escaped | `web-next/lib/csv.ts` `toCSVString` prefixes `= + - @ tab CR`-leading strings |

---

*Last verified: 2026-09-21 (attribution + org-scoped uniqueness pass: signed `x-attribution` tokens on browser-direct scan/analyze, `/api/me/attribution/mint`, org-scoped `UNIQUE` keys on attendance/performance_metrics with idempotent migration)*
