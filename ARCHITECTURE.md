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
| @upstash/redis | ^1.38.0 | `server/package.json:16` |
| @upstash/ratelimit | ^2.0.8 | `server/package.json:15` |
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
│   ├── app/dashboard/         # Dashboard (requires Auth0 session)
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
│   │   ├── UserAvatar.tsx            # Auth0 profile picture / initials
│   │   └── ui/                       # Custom button/card/badge primitives
│   ├── lib/
│   │   ├── api.ts             # API client (all fetch calls)
│   │   ├── auth0.ts           # Auth0Client singleton
│   │   ├── usePipeline.ts     # Pipeline state hook (idle→…→chatting→error)
│   │   ├── sports.ts          # Sport emoji helpers
│   │   └── utils.ts           # cn() class-name helper
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
│   │   ├── auth.ts            # /api/auth/* — user sync, analyses, chat history
│   │   └── health.ts          # GET /health, /health/deep
│   ├── src/lib/
│   │   ├── queue.ts           # BullMQ queue + worker + shutdown
│   │   ├── redis.ts           # Redis client (Upstash REST or local ioredis)
│   │   ├── jobs.ts            # Server-side job mapping (server_job_id → engine_job_id)
│   │   ├── engine.ts          # HTTP client to engine (/scan, /analyze, /status, /download)
│   │   ├── ratelimit.ts       # IP-based rate limiting (scan: 10/min, analysis: 5/hr)
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
- Shape: `{ server_job_id, engine_job_id, session_token, player_index, model, created_at }`

**Rate Limits** (`server/src/lib/ratelimit.ts:82-90`)
- Key: `rl:scan:{ip}` (TTL 60s) — 10 requests/minute (`SCAN_RATE_LIMIT`, default `"10"`)
- Key: `rl:analysis:{ip}` (TTL 3600s) — 5 requests/hour (`ANALYSIS_RATE_LIMIT`, default `"5"` — the 429 message in `analyze.ts:29` states "5 per hour", consistent)

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
- Fields: auth0_id, email, name, nickname, picture, email_verified, created_at, updated_at
- Purpose: Auth0 user sync — upserted on every login via `POST /api/auth/sync`

**chat_messages**
- Primary key: `id` (UUID)
- Fields: server_job_id, auth0_id, role (user/assistant/system), content, timestamp_refs (jsonb), event_refs (jsonb), created_at
- Purpose: Persistent per-analysis chat history (V2 feature)

### In-Memory State

**Engine Sessions** (`engine/main.py:57-58`)
- Stored in Python dict with threading lock
- TTL: 7200 seconds (2 hours, aligned with job TTL), max 10 sessions (`engine/main.py:45-46`)
- Evicted every 300s by `_evict_old_sessions()` loop (`engine/main.py:123-128`)

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
- **Session check:** `auth0.getSession()` called in every protected server component
- **Protected routes:** `/dashboard/*`, `/account` — redirect to `/auth/login` when session absent
- **User identity:** `session.user.sub` (Auth0 subject claim, e.g. `google-oauth2|123` or `github|456`)
- **User sync:** On account page load, `POST /api/auth/sync` upserts the user into the `users` Supabase table
- **Social providers:** Google and GitHub are configured in the Auth0 tenant dashboard (confirmed by CSP `img-src` allowing `*.googleusercontent.com` and `*.githubusercontent.com` in `web-next/next.config.ts`)
- **Logout:** `/auth/logout` (Auth0 SDK route)
- **`auth0_id` propagation:** Frontend sends `x-auth0-id` header on scan and analyze requests; server stores it in `video_conversations.auth0_id` and `analysis_history.auth0_id`

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
- **Frontend:** `web-next/lib/usePipeline.ts:78-84` — pings server `/health` every 8 minutes

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

---

## 10. Known Gaps, Tech Debt, and Contradictions

### Dead Code (files still present)

1. **`engine/core/player_tracker.py`** — Player tracking used only by the CLI (`engine/cli/frame_selector.py`), not the API pipeline.

2. **`engine/core/chunker.py`** — Video chunking used only by the CLI, not the API pipeline.

3. **`engine/core/baseline.py`** — Sport baseline loaders that no Python module imports.

4. **`web-next/components/InlineRename.tsx`** — Exists but is not imported by any other source file.

### Removed Dead Code (since last verification)

Previously documented as dead and since **deleted** from the repo — `pipeline.py`, `connection_pool.py`, `compress.py`, `quality.py`, `analysis_validator.py`, `overlay.py`, `utils.py` (plus the `register_job_input` no-op stub). Not present in `engine/core/` anymore.

### Inconsistencies

1. **`detector.py:32-33`** — Creates a new `HOGDescriptor` per call, while `analyzer.py` caches it at module level. Both exist in the same codebase.

### Resolved (fixed 2026-09-11)

1. ~~`engine/core/analyzer.py` F821 `Any` never imported~~ — `from typing import Any` added; ruff now clean.
2. ~~`web-next` build failure (17 missing `@/components/interior/*` modules)~~ — the component library now lives in `web-next/components/interior/`; `tsc` and `next build` pass. (The unused `dropdown`, `press-depth`, `sticky-header` imports were dropped rather than implemented.)
3. ~~`docker-compose.prod.yml` engine `SERVER_URL: http://engine:8001`~~ — corrected to `http://server:8000` so engine CORS allows the real server origin.
4. ~~Ghost env vars (`BETA_CODES`, `R2_*`, `STORAGE_BACKEND=r2`, `NEXT_PUBLIC_SUPABASE_URL` on server/web samples)~~ — removed from `docker-compose*.yml`, `render.yaml`, `.env.prod.example`, `engine/.env.sample`, `server/.env.example`, `web-next/.env.example`.
5. ~~`JOB_PRIORITIES.beta` dead entry~~ — removed from `server/src/lib/queue.ts`.
6. ~~ruff config deprecation~~ — `engine/pyproject.toml` now uses `[tool.ruff.lint]`.
7. ~~`render.yaml` `runtime: image` with a GitHub URL~~ — switched to `runtime: docker` + `dockerfilePath: Dockerfile` for both services.

### Missing Features

**CI/CD is active** — `.github/workflows/ci.yml` (tests), `deploy.yml` (Render deploys), `keepalive.yml` (GitHub Actions cron).

### Technical Debt

1. **Session memory leak potential** — `engine/main.py:57` dict grows unbounded if `_evict_old_sessions()` is not called frequently enough.

2. **Two Redis libraries in server** — Both `@upstash/redis` and `ioredis` are dependencies; `ioredis` is used for BullMQ and local Redis, `@upstash/redis` for Upstash REST.

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
| Test suite: 49 tests pass | `cd server && bun test` |
| Test suite: 32 tests pass | `cd web-next && npx vitest run` |
| Dead code: baseline.py | `grep -rn "baseline" engine/core/*.py engine/main.py` only self-references |
| Dead code: player_tracker.py/chunker.py | only imported by `engine/cli/` |
| Dead code: InlineRename.tsx | `grep -rn "InlineRename" web-next/` only matches its own file |
| Auth0 auth (beta gate removed) | `grep -rn "BETA_CODES" server/src/` returns nothing |
| Keep-alive: 9 min (external cron only) | `.github/workflows/keepalive.yml` → `GET /health` |
| Frontend status poll: 8 min | `web-next/lib/usePipeline.ts:80` |

---

*Last verified: 2026-09-11 (working tree — includes interior-components fix + lint/infra cleanup)*
