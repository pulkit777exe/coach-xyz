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
│   ├── app/page.tsx           # Main SPA entry point
│   ├── components/            # UI components (LandingPage, PlayerSelector, etc.)
│   ├── lib/api.ts             # API client (scanVideo, startAnalysis, getJobStatus)
│   ├── lib/betaCode.ts        # Beta code localStorage management
│   └── types/index.ts         # Shared type definitions
│
├── server/                    # Middleware server (Bun + Elysia)
│   ├── src/index.ts           # Entry point, middleware, beta code validation
│   ├── src/routes/
│   │   ├── scan.ts            # POST /api/scan-video — upload + player detection
│   │   ├── analyze.ts         # POST /api/analyze-video — enqueue analysis job
│   │   ├── status.ts          # GET /api/job-status/:jobId — poll progress
│   │   ├── download.ts        # GET /api/download/:jobId — stream result video
│   │   └── health.ts          # GET /health, /health/deep
│   ├── src/lib/
│   │   ├── queue.ts           # BullMQ queue + worker + keep-alive + shutdown
│   │   ├── redis.ts           # Redis client (Upstash REST or local ioredis)
│   │   ├── jobs.ts            # Server-side job mapping (server_job_id → engine_job_id)
│   │   ├── engine.ts          # HTTP client to engine (/scan, /analyze, /status, /download)
│   │   ├── ratelimit.ts       # IP-based rate limiting (scan: 10/min, analysis: 5/hr)
│   │   ├── supabaseHistory.ts # PostgreSQL history persistence
│   │   └── errors.ts          # Error types and builders
│   └── src/types/index.ts     # Shared API types
│
├── engine/                    # Video analysis engine (Python + FastAPI)
│   ├── main.py                # FastAPI app, routes, session management
│   ├── core/
│   │   ├── analyzer.py        # Main analysis pipeline (run_analysis)
│   │   ├── detector.py        # Player detection (HOG + MediaPipe pose)
│   │   ├── renderer.py        # Video annotation (HUD, landmarks, summary)
│   │   ├── gemini.py          # Gemini API client
│   │   ├── prompt.py          # System prompt for Gemini
│   │   ├── validator.py       # Gemini output schema validation
│   │   ├── analysis_validator.py # Gemini output validation with retry
│   │   ├── jobs.py            # Engine-side job state machine (Redis)
│   │   ├── cache.py           # Video hash + Redis caching
│   │   ├── dedup.py           # Request deduplication
│   │   ├── storage.py         # Local file storage
│   │   ├── pose_backend.py    # MediaPipe pose detection abstraction
│   │   ├── compress.py        # Video compression (FFmpeg)
│   │   ├── quality.py         # Frame quality filtering
│   │   ├── errors.py          # Error types hierarchy
│   │   ├── pipeline.py        # Staged pipeline (DEAD CODE — not imported)
│   │   ├── connection_pool.py # HTTP connection pooling (DEAD CODE — not imported)
│   │   ├── player_tracker.py  # Player tracking
│   │   ├── chunker.py         # Video chunking
│   │   ├── overlay.py         # Video overlay
│   │   └── utils.py           # Utilities
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

### Supabase Tables (CONFIRMED — `server/src/lib/supabaseHistory.ts:84-132`)

**video_conversations**
- Primary key: `session_token`
- Fields: file_name, file_mime_type, file_size_bytes, player_count, players_json, scan_response_json, beta_code, client_ip, user_agent, source

**analysis_history**
- Primary key: `server_job_id`
- Fields: engine_job_id, session_token, player_index, model, stage, stage_name, progress, complete, video_ready, summary_json, status_json, error_code, error_message, download_count

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

### Beta Code System (CONFIRMED)

The system uses a simple beta code gate, not JWT or session-based auth:

- **Validation:** `server/src/index.ts:26-37` — codes from `BETA_CODES` env var (comma-separated)
- **Middleware:** `server/src/index.ts:82-92` — `onBeforeHandle` checks `x-beta-code` header
- **Public endpoints:** `/health`, `/api/verify-code`, `/swagger` (exempt from check)
- **Frontend:** `web-next/lib/betaCode.ts` — stores code in localStorage, sends as header
- **Storage:** `server/src/lib/supabaseHistory.ts:93,119` — beta code logged to database

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

- **Client:** `engine/core/gemini.py:11-17` — `google-genai` SDK
- **Key env:** `GEMINI_API_KEY` (required, `engine/main.py:29`)
- **Model:** `gemini-2.5-flash` (`web-next/lib/api.ts:114`, `server/src/routes/analyze.ts:47`)
- **Usage:** Video analysis with structured JSON output
- **Timeout:** 12 minutes per job (`server/src/lib/queue.ts:86`)

### Upstash Redis (CONFIRMED)

- **Engine:** `engine/core/jobs.py:10-17` — REST client (`upstash-redis` Python)
- **Server:** `server/src/lib/redis.ts:6-48` — REST (`@upstash/redis`) or TCP (`ioredis`)
- **Queue:** `server/src/lib/queue.ts:6-16` — TCP connection (`ioredis`) for BullMQ
- **Env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_IOREDIS_URL`

### Supabase PostgreSQL (CONFIRMED)

- **Client:** `server/src/lib/supabaseHistory.ts:1,43-48` — Bun's `SQL` client
- **Env var:** `DATABASE_URL`
- **Tables:** `video_conversations`, `analysis_history` (auto-created on startup)
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
