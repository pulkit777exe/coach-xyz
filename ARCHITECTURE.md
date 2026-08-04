# Coach-XYZ Architecture

## 1. Overview

Coach-XYZ is a sports video analysis platform that uses Google Gemini AI to analyze athlete technique. Users upload sports videos (basketball, football, cricket, tennis, baseball, hockey), the system detects players, sends frames to Gemini for biomechanical analysis, and returns an annotated video with performance feedback. The system is designed for zero-cost deployment on free-tier infrastructure.

---

## 2. Tech Stack

### Frontend (`web-next/`)
| Technology | Version | Source |
|------------|---------|--------|
| Next.js | ^16.2.9 | `web-next/package.json:13` |
| React | ^19.2.7 | `web-next/package.json:14` |
| Tailwind CSS | ^4.3.1 | `web-next/package.json:20` |
| GSAP | ^3.15.0 | `web-next/package.json:12` |
| TypeScript | ^5.9.3 | `web-next/package.json:24` |

### Server (`server/`)
| Technology | Version | Source |
|------------|---------|--------|
| Bun | (runtime) | `server/Dockerfile:1` — `oven/bun:1` |
| Elysia | ^1.4.29 | `server/package.json:17` |
| BullMQ | ^5.79.2 | `server/package.json:16` |
| ioredis | ^5.11.1 | `server/package.json:18` |
| @upstash/redis | ^1.38.0 | `server/package.json:15` |
| @upstash/ratelimit | ^2.0.8 | `server/package.json:14` |
| TypeScript | ^5.9.3 | `server/package.json:22` |

### Engine (`engine/`)
| Technology | Version | Source |
|------------|---------|--------|
| Python | 3.11 | `engine/Dockerfile:1` |
| FastAPI | 0.138.2 | `engine/requirements.txt:1` |
| uvicorn | 0.49.0 | `engine/requirements.txt:2` |
| google-genai | 2.10.0 | `engine/requirements.txt:3` |
| opencv-python-headless | 4.13.0.92 | `engine/requirements.txt:4` |
| mediapipe | 0.10.35 | `engine/requirements.txt:7` |
| upstash-redis | 1.7.0 | `engine/requirements.txt:8` |
| orjson | 3.11.9 | `engine/requirements.txt:9` |

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
│   │   ├── ResultsSummary.tsx        # Completed analysis summary
│   │   ├── UserAvatar.tsx            # Auth0 profile picture / initials
│   │   └── ui/                       # shadcn/ui primitives
│   ├── lib/
│   │   ├── api.ts             # API client (all fetch calls)
│   │   ├── auth0.ts           # Auth0Client singleton
│   │   ├── usePipeline.ts     # Pipeline state hook
│   │   └── sports.ts          # Sport config helpers
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
│   │   ├── queue.ts           # BullMQ queue + worker + keep-alive + shutdown
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
│   │   ├── pipeline.py        # Staged pipeline (DEAD CODE — not imported)
│   │   ├── connection_pool.py # HTTP connection pooling (DEAD CODE — not imported)
│   │   ├── analysis_validator.py # Schema validation with retry (DEAD CODE — not called)
│   │   ├── compress.py        # Video compression (DEAD CODE — not called from pipeline)
│   │   ├── quality.py         # Frame quality filtering (DEAD CODE — not called from pipeline)
│   │   ├── overlay.py         # Video overlay (DEAD CODE — not imported)
│   │   ├── utils.py           # Utilities (only imported by overlay.py — dead)
│   │   ├── player_tracker.py  # Player tracking (CLI only)
│   │   └── chunker.py         # Video chunking (CLI only)
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

**Rate Limits** (`server/src/lib/ratelimit.ts:31-38`)
- Key: `rl:scan:{ip}` (TTL 60s) — 10 requests/minute
- Key: `rl:analysis:{ip}` (TTL 3600s) — 5 requests/hour

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
- TTL: 3600 seconds (1 hour), max 10 sessions
- Shape: `{ video_key, players, created_at }`

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

- Engine: Free tier web service, image deployment from GitHub
- Server: Free tier web service, image deployment from GitHub
- Env vars synced from Render dashboard (secrets)
- `<your-org>` placeholder must be replaced with actual GitHub org

### Vercel Deployment (CONFIRMED — `web-next/vercel.json`)

- Framework: Next.js
- Build: `next build`
- Output: `.next`
- Env: `NEXT_PUBLIC_API_URL` from server service

### Keep-Alive (CONFIRMED)

- **Server:** `server/src/lib/queue.ts:43-58` — pings `/health` every 10 minutes in production
- **Frontend:** `web-next/app/page.tsx:37-42` — pings server `/health` every 8 minutes

### Graceful Shutdown (CONFIRMED — `server/src/lib/queue.ts:167-193`)

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

### Dead Code

1. **`engine/core/pipeline.py`** — `AnalysisPipeline` class exists but is never imported by `analyzer.py` or any other file. Provides per-stage Redis caching that is not used.

2. **`engine/core/connection_pool.py`** — `ConnectionPool` class exists but is never imported. Gemini API calls use new connections each time. Also imports `httpx` which is not in `requirements.txt`.

3. **`engine/core/compress.py`** — `compress_for_analysis()` function exists but is never called from the API pipeline.

4. **`engine/core/quality.py`** — `filter_quality_frames()` and `assess_frame_quality()` exist but are never called from the API pipeline.

5. **`engine/core/analysis_validator.py`** — `validate_gemini_output()` exists but is never called. Actual Gemini validation in `analyzer.py:536` only does `json.loads()`.

6. **`engine/core/overlay.py`** — Drawing functions exist but are never imported. Appears to be an alternative to `renderer.py`.

7. **`engine/core/utils.py`** — Only imported by `overlay.py` (dead code).

### Partially Used Code

8. **`engine/core/chunker.py`** — Used only by CLI tools (`engine/cli/`), not the API pipeline.

9. **`engine/core/player_tracker.py`** — Used only by CLI tools (`engine/cli/frame_selector.py`), not the API pipeline.

### Inconsistencies

3. **`detector.py:32-33`** — Creates new `HOGDescriptor` per call, while `analyzer.py:16-17` caches it at module level. Both exist in the same codebase.

4. **`register_job_input`** — `engine/core/jobs.py:184-186` is a no-op stub, called from `analyzer.py:549`.

### Missing Features

5. **No test suite** — No test files found anywhere in the codebase.

6. **No CI/CD** — No GitHub Actions workflows, no `.github/` directory.

7. **`render.yaml:11,33`** — `<your-org>` placeholder not replaced; deployment will fail.

8. **`httpx` not in requirements** — `engine/core/connection_pool.py:3` imports `httpx` but it is not listed in `engine/requirements.txt`.

### Technical Debt

8. **Session memory leak potential** — `engine/main.py:57` dict grows unbounded if `_evict_old_sessions()` is not called frequently enough.

9. **Two Redis libraries in server** — Both `@upstash/redis` and `ioredis` are dependencies; `ioredis` is used for BullMQ and local Redis, `@upstash/redis` for Upstash REST.

---

## 11. How to Verify This Document

| Claim | Verification |
|-------|--------------|
| Next.js ^16.2.9 | `web-next/package.json:13` |
| Elysia ^1.4.29 | `server/package.json:17` |
| FastAPI 0.138.2 | `engine/requirements.txt:1` |
| google-genai 2.10.0 | `engine/requirements.txt:3` |
| BullMQ concurrency: 1 | `server/src/lib/queue.ts:104` |
| Worker timeout: 12 min | `server/src/lib/queue.ts:86` |
| Stuck job recovery: 13 min | `server/src/lib/queue.ts:139` |
| Session TTL: 1 hour | `engine/main.py:25` |
| Cache TTL: 24 hours | `engine/core/cache.py:25` |
| Rate limit: 5 analysis/hour | `server/src/lib/ratelimit.ts:60-61` |
| Local storage only | `engine/core/storage.py:25-26` |
| Pipeline states | `engine/core/jobs.py:27-35` |
| Valid transitions | `engine/core/jobs.py:38-46` |
| Dead code: pipeline.py | `grep -r "from core.pipeline" engine/` returns nothing |
| Dead code: connection_pool.py | `grep -r "from core.connection_pool" engine/` returns nothing |
| Dead code: compress.py | `grep -r "compress_for_analysis" engine/` only returns definition |
| Dead code: quality.py | `grep -r "filter_quality_frames" engine/` only returns definition |
| Dead code: analysis_validator.py | `grep -r "validate_gemini_output" engine/` only returns definition |
| Dead code: overlay.py | `grep -r "from core.overlay" engine/` returns nothing |
| Dead code: utils.py | `grep -r "from core.utils" engine/` only returns overlay.py import |
| Beta code middleware | `server/src/index.ts:82-92` |
| Keep-alive: 10 min | `server/src/lib/queue.ts:44` |
| Frontend keep-alive: 8 min | `web-next/app/page.tsx:40` |

---

*Last verified: 2026-07-02, against commit 2c37df2*
