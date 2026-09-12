# V1 — Current Application

> A living document of what Coach-XYZ offers today. Last verified against source: 2026-09-11.

---

## 1. What It Does

Coach-XYZ is a **one-shot sports video analysis platform**. A user uploads a training clip, the system detects players, sends keyframes to Google Gemini for biomechanical analysis, and returns:

- A **form score** (1–10) with per-event breakdown
- **Coaching feedback** for every detected event (shot, pass, drive, etc.)
- An **annotated video** with pose overlays, HUD stats, and a summary screen
- A **session summary** with strengths, weaknesses, and a priority drill

The entire flow is **fire-and-forget**: upload → wait → get results. Follow-up questions about the
analysis are answered by the **chat with the AI coach** (see §8.4 and `V2_COACH.md` — now implemented).

---

## 2. User Flow

```
┌─────────────┐     ┌──────────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐
│  Landing     │────▶│  Upload  │────▶│  Scan /  │────▶│  Analyze  │────▶│  Results │
│  Page        │     │  Video   │     │  Detect  │     │  (poll)   │     │  + DL    │
└─────────────┘     └──────────┘     │  Players │     └───────────┘     └──────────┘
                                      └──────────┘
                                            │
                                     (if >1 player)
                                            │
                                       ┌────▼─────┐
                                       │  Select   │
                                       │  Player   │
                                       └──────────┘
```

### Step-by-step

| # | State | What happens | Duration |
|---|-------|-------------|----------|
| 1 | **idle** | User lands on marketing page, scrolls through features/FAQ, reaches upload zone | User-driven |
| 2 | **uploading** | File validated (video, ≤500MB), sent as FormData to `POST /api/scan-video` | 10–60s |
| 3 | **scanning** | Engine streams video to disk, runs HOG + MediaPipe player detection, creates session | Included in step 2 |
| 4 | **selecting** | If >1 player detected, user picks one from a grid of cropped images with confidence scores | User-driven |
| 5 | **analyzing** | `POST /api/analyze-video` enqueues job to BullMQ. Frontend polls `GET /api/job-status/:jobId` every 2s | 30–120s |
| 6 | **rendering** | Engine renders annotated video (pose overlays, HUD, summary screen) | 15–30s |
| 7 | **completed** | Results displayed: form score, assessment, tips, strengths, shot events, download button | User-driven |

### Error states

Any step can fail. Errors surface in a dedicated `ErrorScreen` with 25+ error codes, auto-retry for rate limits, and a retry button for retryable errors.

---

## 3. Pages & Components

### 3.1 Route Structure

The app uses Next.js App Router with server-rendered pages for dashboard/history, and client-side state for the upload pipeline.

| Route | Rendering | Purpose |
|---|---|---|
| `/` | Client (SPA) | Landing page with upload pipeline (`usePipeline()`) |
| `/dashboard` | Server | Dashboard home — recent analyses |
| `/dashboard/history` | Server | Paginated history of all analyses |
| `/dashboard/analysis/[id]` | Server | Analysis detail — results, chat, download |
| `/dashboard/analysis/[id]/chat` | Server | Standalone chat page for an analysis |
| `/account` | Server | Account settings |

#### Pipeline states (client-side on `/`, rendered by `AppClient.tsx`)

| Pipeline State | Rendered Component | Lines |
|---|---|---|
| `idle` | `LandingPage` | 620 |
| `uploading` / `scanning` | `RotatingMessage` spinner (in `AppClient.tsx`) | 25 |
| `selecting` | `PlayerSelector` | 144 |
| `analyzing` / `rendering` | `AnalysisProgress` | 176 |
| `completed` | `ResultsSummary` | 223 |
| `chatting` | `ChatLayout` (video + chat, V2) | 93 |
| `error` | `ErrorScreen` | 273 |

### 3.2 Component Inventory

| Component | File | Purpose |
|---|---|---|
| `LandingPage` | `components/LandingPage.tsx` | Full marketing page: hero, upload zone, workflow, features, sports, testimonial, FAQ, CTA, footer. 620 lines. |
| `AppClient` | `components/AppClient.tsx` | Root pipeline renderer — switches on `pipelineState`. |
| `PlayerSelector` | `components/PlayerSelector.tsx` | Grid of detected players with base64 crop images, confidence badges, select + confirm. |
| `AnalysisProgress` | `components/AnalysisProgress.tsx` | Progress bar, stage stepper (Queued → Detecting → Analyzing → Rendering → Complete), ETA. |
| `ResultsSummary` | `components/ResultsSummary.tsx` | Form score, overall assessment, priority tips, strengths, shot event timeline, download button. |
| `ErrorScreen` | `components/ErrorScreen.tsx` | Error details with 25+ code mappings, auto-retry countdown, retry button. |
| `AnalysisDetailClient` | `components/AnalysisDetailClient.tsx` | Dashboard detail page: polling, rename, download/preview, stats, shot events, embedded chat. |
| `AnalysisTitle` | `components/AnalysisTitle.tsx` | Click-to-rename analysis heading (PATCH via `renameAnalysis`). |
| `InlineRename` | `components/InlineRename.tsx` | Inline-rename helper — **currently not imported by any other file (dead)**. |
| `HistoryChat` | `components/HistoryChat.tsx` | Auth-scoped chat panel for a completed analysis (dashboard detail page). |

### 3.3 UI Primitives

| Component | File | Notes |
|---|---|---|
| `Button` | `components/ui/button.tsx` | 4 variants (default/secondary/outline/ghost), 3 sizes. Custom, not shadcn. |
| `Card` | `components/ui/card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent. |
| `Badge` | `components/ui/badge.tsx` | 5 variants (default/secondary/destructive/muted/outline). |
| `Separator` | `components/ui/separator.tsx` | Horizontal/vertical separator. |

### 3.4 Design System

- **Background:** `#0d0d0d` (dark)
- **Foreground:** `#f0ebe1` (cream)
- **Accent:** `#c8003c` (red, used sparingly)
- **Fonts:** DM Mono (body), Instrument Serif (headings)
- **Effects:** Film grain canvas (landing only), GSAP scroll animations, marquee ticker
- **Theme:** Dark, minimal, editorial — serif + mono typography with transparency layers

---

## 4. API Surface

### 4.1 Client → Server

| Endpoint | Method | Purpose | Timeout |
|---|---|---|---|
| `/api/scan-video` | POST | Upload video, detect players, return session token + video_key | 120s (upload) / 180s (engine) |
| `/api/scan-progress/:sessionToken` | GET | SSE stream of scan progress (proxied from engine) | — |
| `/api/analyze-video` | POST | Enqueue analysis job, return job ID | 30s |
| `/api/job-status/:jobId` | GET | Poll job progress (state, stage, summary, video_ready); falls back to Supabase when Redis expires | 15s |
| `/api/download/:jobId` | GET | Stream annotated video (served inline; via Next.js `/api/download` rewrite) | — |
| `/api/chat` | POST | Send one message to AI coach (non-streaming) | 60s |
| `/api/chat/stream` | POST | SSE streaming chat (token-by-token) | 120s |
| `/api/conversation/:jobId` | GET | Load in-memory (Redis) conversation history | 10s |
| `/api/auth/sync` | POST | Upsert Auth0 user into `users` | 10s |
| `/api/auth/user/:auth0Id` | GET | Fetch user record | 10s |
| `/api/auth/user/:auth0Id/analyses` | GET | Paginated analysis history (limit ≤ 100, default 20) | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId` | GET | Single analysis detail with file info | 10s |
| `/api/auth/user/:auth0Id/stats` | GET | Aggregate stats (total/completed/in-progress/failed, downloads) | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId` | PATCH | Rename an analysis (`display_name`) — the only rename endpoint | 5s |
| `/api/auth/user/:auth0Id/analyses/:jobId/chat` | GET | Load persisted chat history (Supabase `chat_messages`) | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId/chat` | POST | Send chat message; persists + falls back to keyword reply when engine is down | 30s |

> **Note:** `/api/rename/:jobId`, `/api/conversations` (list), `DELETE /api/conversations/:jobId`,
> and `/api/dashboard` are documented in older revisions but **do not exist**. Rename is the
> auth-scoped PATCH above; dashboard data comes from `/api/auth/user/:id/analyses` + `/stats`.

### 4.2 Server → Engine

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /scan` | Forward video upload, run player detection |
| `GET /scan-progress/{session_token}` | SSE scan progress feed |
| `POST /analyze` | Trigger synchronous analysis (BullMQ worker calls this) |
| `GET /status/:jobId` | Read job status from engine Redis |
| `GET /download/:jobId` | Stream video file from engine storage (inline) |
| `POST /fail/:jobId` | Mark a job as failed |
| `POST /chat` | Chat with AI coach (non-streaming) |
| `POST /chat/stream` | SSE streaming chat |

### 4.3 Engine Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /scan` | Upload video, detect players, create session, return video_key |
| `GET /scan-progress/{session_token}` | SSE stream for live scan progress |
| `POST /analyze` | Run full analysis pipeline (sync, called by BullMQ) |
| `POST /analyze-async` | Fire-and-forget analysis (returns job ID immediately) |
| `GET /status/:jobId` | Read job status from Redis |
| `GET /download/:jobId` | Stream video from local storage (inline) |
| `GET /analyze-progress/:jobId` | SSE stream for live progress |
| `POST /chat` | Chat with AI coach about an analysis (non-streaming) |
| `POST /chat/stream` | SSE streaming chat |
| `POST /fail/:jobId` | Mark a job as failed (called by server on BullMQ exhaustion) |
| `GET /health` | Shallow health check |
| `GET /health/deep` | Deep health (Redis, disk, MediaPipe) |

> **Note:** `GET /chat-history/:jobId` was documented in an earlier revision but is **not implemented**
> in `engine/main.py`. Chat history is served by the server from Redis/Supabase instead.

---

## 5. Architecture

### 5.1 Three-Tier Pipeline

```
Frontend (Next.js :3000)
    │
    ▼
Server (Elysia + Bun :8000)
    │  ├── BullMQ queue
    │  ├── Redis (job mapping)
    │  └── Supabase (history)
    ▼
Engine (FastAPI + Python :8001)
    │  ├── Redis (job state)
    │  ├── Local filesystem (video storage)
    │  ├── MediaPipe (player detection)
    │  └── Google Gemini (AI analysis)
    ▼
```

**Key constraint:** The frontend never talks to the engine directly. All requests go through the server.

### 5.2 Job Lifecycle

```
1. Frontend POST /api/analyze-video
2. Server creates server_job_id + engine_job_id
3. Server saves mapping to Redis (coachai:srv:<uuid>)
4. Server enqueues to BullMQ
5. Server returns { job_id: server_job_id }
6. BullMQ worker picks up job
7. Worker calls POST /analyze on engine
8. Engine creates job in its Redis (coachai:job:<uuid>)
9. Engine runs analysis pipeline
10. Engine updates Redis at each stage
11. Frontend polls GET /api/job-status/:jobId
12. Server reads server job from Redis
13. Server fetches engine status via HTTP
14. Server returns status to frontend
15. On completion: frontend shows results
```

### 5.3 Data Flow for Analysis

```
Video upload
    │
    ▼
Engine streams to /app/tmp/storage/
    │
    ▼
Player detection (HOG + MediaPipe pose)
    │
    ▼
Keyframe extraction (3s intervals, max 30 frames)
    │
    ▼
Frame scoring (0.4 × visibility + 0.6 × motion)
    │
    ▼
Top 30 frames → Gemini API (multimodal: images + metadata text)
    │
    ▼
Gemini returns structured JSON (shots, session_summary)
    │
    ▼
normalize_gemini_result() → frontend AnalysisSummary format
    │
    ▼
Render annotated video (pose overlays, HUD, summary screen)
    │
    ▼
Upload to storage, mark job complete
```

### 5.4 State Management

- **Frontend:** `usePipeline()` custom hook with `useState`/`useRef`. No external state library.
- **Server → Engine mapping:** Redis hash `coachai:srv:<uuid>` (2h TTL)
- **Engine job state:** Redis hash `coachai:job:<uuid>` (2h TTL)
- **Analysis cache:** Redis `coachai:analysis:<hash>:p<player>` (24h TTL)
- **Rate limiting:** Redis `rl:scan:<ip>` (60s window), `rl:analysis:<ip>` (3600s window)
- **BullMQ:** Separate Redis connection for queue/worker

---

## 6. Supported Sports

| Sport | Events Detected | Specific Stats |
|---|---|---|
| **Basketball** | Jump shots, layups, free throws, 3-pointers, dunks | shots made/missed, 3-pointers, layups, free throws |
| **Football** | Strikes, headers, volleys, penalties, shots on target | goals, shots on target, shots missed, headers |
| **Cricket** | Drives, pulls, sweeps, cuts, hooks | runs, fours, sixes, wickets, dot balls, balls faced |
| **Tennis** | Serves, forehands, backhands, volleys | aces, winners, errors, double faults |
| **Baseball** | Pitches, swings, hits | hits, outs, walks, strikeouts |
| **Hockey** | Shots, saves, blocks | goals, saves, shots on goal, blocks |

Sport is auto-detected by Gemini unless forced via the `sport` parameter.

---

## 7. Error Handling

### 7.1 Error Shape

```typescript
type CoachAIError = {
  code: string           // e.g. "RATE_LIMITED", "GEMINI_QUOTA_EXCEEDED"
  message: string        // Human-readable
  layer: "client" | "server" | "engine"
  retryable: boolean
  retry_after?: number   // Seconds (for rate limits)
}
```

### 7.2 Error Codes (25+)

| Category | Codes |
|---|---|
| **Client** | `INVALID_TYPE`, `FILE_TOO_LARGE`, `NETWORK_ERROR`, `REQUEST_FAILED`, `REQUEST_TIMEOUT` |
| **Server** | `RATE_LIMITED`, `QUEUE_UNAVAILABLE`, `INVALID_REQUEST`, `NO_FILE`, `INVALID_FILE_TYPE`, `INVALID_SESSION_TOKEN`, `INVALID_PLAYER_INDEX` |
| **Engine** | `NO_PLAYERS_DETECTED`, `VIDEO_DECODE_FAILED`, `VIDEO_EXPIRED`, `VIDEO_NOT_FOUND`, `GEMINI_QUOTA_EXCEEDED`, `GEMINI_TIMEOUT`, `GEMINI_PARSE_FAILED`, `GEMINI_PROCESSING_FAILED`, `REDIS_UNAVAILABLE`, `INTERNAL_ERROR`, `JOB_NOT_FOUND`, `ENGINE_UNAVAILABLE`, `ENGINE_ERROR`, `MEDIAPIPE_UNAVAILABLE`, `STORAGE_ERROR`, `ANALYSIS_FAILED`, `ANALYSIS_TIMEOUT` |

### 7.3 Retry Behavior

- Rate-limited errors: auto-retry countdown (configurable `retry_after`)
- Transient network errors: exponential backoff (5 retries, max 30s delay)
- Non-retryable errors: contact support link
- All errors are non-fatal to the API (history writes fail gracefully)

---

## 8. Infrastructure

### 8.1 Deployment

| Service | Platform | URL |
|---|---|---|
| Frontend | Vercel | coach-xyz.vercel.app |
| Server | Render (free tier) | coach-xyz-server.onrender.com |
| Engine | Render (free tier) | coach-xyz-engine.onrender.com |
| Database | Supabase (free tier) | tocfriargasmbpufmxzg.supabase.co |
| Queue | Upstash Redis (free tier) | — |

### 8.2 Free-Tier Constraints

- **Render free tier:** Services spin down after 15min inactivity. Keep-alive pings every 8–10min.
- **Upstash free tier:** 10,000 commands/day, 256MB storage
- **Supabase free tier:** 500MB database, pausing after inactivity
- **Vercel free tier:** 100GB bandwidth/month

### 8.3 Keep-Alive Strategy

| Component | Interval | Target |
|---|---|---|
| Frontend → Server | 8 min | `GET /health` |
| Server → Engine | 10 min | `GET /health` |
| Engine session eviction | 5 min | In-memory cleanup (`_evict_old_sessions`) |
| BullMQ stuck recovery | 10 min | Jobs active > 13 min → `moveToFailed` (1 min buffer over 12-min timeout) |

---

## 9. Security

- **Auth:** Auth0 (Google + GitHub social login) via `@auth0/nextjs-auth0`. `/dashboard/*` and `/account` redirect to `/auth/login` when unauthenticated. APIs are identified by the `x-auth0-id` header or `:auth0Id` path params (no server-side session check on API routes).
- **CORS:** Configured for `FRONTEND_URL` origin only (server) and `SERVER_URL` origin (engine)
- **CSP:** Strict Content-Security-Policy header on both Next.js and Elysia
- **HSTS:** Strict-Transport-Security enabled (Next.js always; Elysia when serving over HTTPS)
- **Rate limiting:** Per-IP — scan: **10/min**, analysis: **5/hour** (`SCAN_RATE_LIMIT`/`ANALYSIS_RATE_LIMIT`, atomic Redis increments, in-memory fallback)
- **File validation:** MIME type check, 500MB size limit (413 on oversized Content-Length)
- **Sentry:** Integrated on all three layers (frontend, server, engine)

---

## 10. What's Missing (Known Gaps)

| Gap | Impact | Status |
|---|---|---|
| No conversational follow-up | User gets one analysis, can't ask questions | ✅ Implemented — chat with AI coach on analysis detail page (streaming + non-streaming + Supabase persistence) |
| No URL routing | Can't share results, back button broken | ✅ Implemented — full pipeline URL routing, refresh resilience, `/dashboard/analysis/[id]` |
| No page transitions | Jarring state switches | ❌ Open |
| Bare upload UX | Spinner only, no progress percentage | ✅ Implemented — SSE scan progress with rotating status lines + percentage |
| Film grain only on landing | Visual inconsistency across screens | ❌ Open |
| No breadcrumbs | User doesn't know where they are in the flow | ❌ Open |
| Single-player analysis only | Can't compare players or track progress over time | ❌ Open |
| No history browsing | Past analyses not accessible from UI | ✅ Implemented — `/dashboard/history` with pagination |
| No export/share | Can't share results link or export PDF report | ❌ Open |
| `/dashboard/analysis/[id]` page won't build | AnalysisDetailClient imported 17 nonexistent `@/components/interior/*` components; `next build` failed. | ✅ Fixed — the `interior/` component library now exists (`components/interior/`); `next build` + `tsc` pass |
