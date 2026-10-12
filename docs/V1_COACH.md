# V1 — Current Application

> A living document of what CoachXYZ offers today. Last verified against source: 2026-10-11.

---

## 1. What It Does

CoachXYZ is a **sports video analysis + coaching platform**. A user uploads a training clip, the system detects players, sends keyframes to Google Gemini for biomechanical analysis, and returns:

- A **form score** (1–10) with per-event breakdown
- **Coaching feedback** for every detected event (shot, pass, drive, etc.)
- **Evidence findings** — one finding per scored event with severity, confidence, evidence frames, and a needs-review gate
- An **annotated video** with pose overlays, HUD stats, and a summary screen
- A **session summary** with strengths, weaknesses, and a priority drill
- **Video clips** (coach-bookmarked subclips) and a **click-to-seek findings timeline**

Around the pipeline sits a full coaching org: roster + teams + staff roles/invites,
attendance, schedule, objectives kanban, training plans, wellness check-ins,
reports (print/email/AI-generated), share links, notifications, and a read-only
player hub. Follow-up questions are answered by the **streaming chat with the AI
coach** (see §8.4 and `V2_COACH.md`).

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
| 2 | **uploading** | File validated (video, ≤500MB, ffprobe-inspected at scan), sent as FormData to `POST /api/scan-video` (or intent-first: `/scan-intent` → direct upload → `/scan-from-key`) | 10–60s |
| 3 | **scanning** | Engine stores video (`raw/{session}/{angle}`), runs HOG + MediaPipe player detection, creates multicam-aware session; progress streams over SSE | Included in step 2 |
| 4 | **selecting** | If >1 player detected, user picks one (grid of cropped images with confidence scores) and optionally an angle | User-driven |
| 5 | **analyzing** | `POST /api/analyze-video` enqueues to BullMQ (signed-in jobs outrank anonymous; tier bump for pro/elite). Frontend polls `GET /api/job-status/:jobId` every 2s | 30–120s typical (12-min timeout, 13-min stuck recovery) |
| 6 | **rendering** | Engine derives findings, runs the quality gate, renders annotated video (pose overlays, HUD, summary screen) | 15–30s |
| 7 | **completed** | Results displayed: form score, assessment, tips, strengths, findings timeline, clips, download + share buttons | User-driven |

Jobs can be **cancelled** in progress and **deleted** from history (cascades to findings + chat, audited).
| 7 | **completed** | Results displayed: form score, assessment, tips, strengths, findings timeline, clips, download + share buttons | User-driven |

### Error states

Any step can fail. Errors surface in a dedicated `ErrorScreen` with 25+ error codes (canonical `CoachAIError`: `code`/`message`/`layer`/`retryable`/`retry_after?`), auto-retry for rate limits, and a retry button for retryable errors.

---

## 3. Pages & Components

### 3.1 Route Structure

The app uses Next.js App Router: server-rendered pages for dashboard/player/marketing, client-side state for the upload pipeline.

| Route | Rendering | Purpose |
|---|---|---|
| `/` | Server shell → client SPA | Landing page with upload pipeline (`AppClient` over `usePipeline`/`useScanFlow`) |
| `/dashboard` | Server | Role-differentiated home (full / staff / personal player view) |
| `/dashboard/students` + `/students/[id]` | Server | Roster CRUD + CSV import, student profile (performance, objectives, wellness) |
| `/dashboard/teams` | Server | Team CRUD + membership + per-team finding trends |
| `/dashboard/members` | Server | Staff roles + single-use token invites (owner/admin/head_coach/coach) |
| `/dashboard/audit` | Server | Audit log with action filter (owner/admin) |
| `/dashboard/attendance` | Server | Attendance grid + batch entry |
| `/dashboard/schedule` | Server | Schedule calendar (Monday-first) |
| `/dashboard/reports` + `/reports/[id]` | Server | Reports list + detail (print/email/AI-generated) |
| `/dashboard/history` | Server | Paginated history of all analyses |
| `/dashboard/analysis/[id]` | Server | Analysis detail — results, findings, clips, chat, download/share |
| `/dashboard/analysis/[id]/chat` | Server | Standalone chat page for an analysis |
| `/dashboard/settings` | Server | Profile, preferences (theme/week-start/motion), org |
| `/player` | Server | Player hub (coaches redirect to `/dashboard`) |
| `/invite` | Server shell → client | Token-invite accept flow |
| `/share/[token]` | Server | Public shared-analysis view |
| `/account` | Server | Account settings |
| `/about` `/features` `/pricing` `/contact` `/blog` `/terms` `/privacy` | Server/static | Marketing site (always-dark) |

Every page carries a `PageHeader` trail rooted at Home (detail pages use the record name); ⌘K `SidebarSearch` jumps to role-gated pages + player search.

#### Pipeline states (client-side on `/`, rendered by `AppClient.tsx`)

| Pipeline State | Rendered Component |
|---|---|
| `idle` | `LandingPage` |
| `uploading` / `scanning` | Rotating-status view (in `AppClient.tsx`, SSE scan progress) |
| `selecting` | `PlayerSelector` (player grid + angle picker) |
| `analyzing` / `rendering` | `AnalysisProgress` (stage stepper, ETA) |
| `completed` | `ResultsSummary` (score, findings, clips, download/share) |
| `chatting` | `ChatLayout` (video + chat) |
| `error` | `ErrorScreen` |

### 3.2 Component Inventory

| Component | File | Purpose |
|---|---|---|
| `LandingPage` | `components/LandingPage.tsx` | Marketing hero + upload zone, workflow, features, sports, testimonial, FAQ, CTA, footer |
| `AppClient` | `components/AppClient.tsx` | Root pipeline renderer — switches on `pipelineState` |
| `PlayerSelector` | `components/PlayerSelector.tsx` | Detected players (base64 crops, confidence badges) + angle picker, select + confirm |
| `AnalysisProgress` | `components/AnalysisProgress.tsx` | Progress bar, stage stepper (Queued → Detecting → Analyzing → Rendering → Complete), ETA |
| `ResultsSummary` | `components/ResultsSummary.tsx` | Form score, overall assessment, priority tips, strengths, shot event timeline, download/share |
| `ErrorScreen` | `components/ErrorScreen.tsx` | Error details with 25+ code mappings, auto-retry countdown, retry button |
| `AnalysisDetailClient` | `components/AnalysisDetailClient.tsx` | Dashboard detail page: polling, rename, cancel/delete, download/preview, stats, findings, clips, embedded chat |
| `FindingsTimeline` | `components/FindingsTimeline.tsx` | Findings list with severity bands, click-to-seek, approve/flag review |
| `ClipsSection` | `components/ClipsSection.tsx` | Coach clip CRUD with click-to-seek |
| `AnalysisTitle` | `components/AnalysisTitle.tsx` | Click-to-rename analysis heading (PATCH via `renameAnalysis`) |
| `HistoryChat` | `components/HistoryChat.tsx` | Auth-scoped chat panel for a completed analysis |
| `VideoPlayer` | `components/VideoPlayer.tsx` | Video player with seek ref + timestamp sync |
| `SidebarSearch` | `components/SidebarSearch.tsx` | ⌘K palette: role-gated pages + player search |
| `GlobalSearch` | `components/GlobalSearch.tsx` | Org-level search box |
| `PlayerHub` | `components/player/PlayerHub.tsx` | Read-only player self view (`/api/me/*`) + self uploads |
| `NotificationBell` | `components/notifications/NotificationBell.tsx` | Notifications bell with SSE subscription |
| org/* | `components/org/` | Students/Teams/Members/Audit/AttendanceGrid/Schedule/Reports/Objectives (kanban)/Plans/Wellness/PerformanceChart (lazy recharts)/dialogs/PageHeader/OrgSwitcher |

### 3.3 UI Primitives

`components/9ui/ui/` (shadcn-style: avatar, badge, button, card, chart, checkbox, dialog, dropdown-menu, input, label, select, sonner, switch, textarea) plus `components/interior/` generic primitives (modal, drawer, popover, lightbox, segmented-control, …). Legacy `components/ui/*` is deleted — do not resurrect.

### 3.4 Design System

- **Theme:** dark editorial (cream on near-black) + light mode via `next-themes` (`ThemeToggle`); marketing pages are always-dark using `--marketing-*` vars
- **Tokens:** Tailwind classes via `app/globals.css` (`bg-card`, `text-muted-foreground`, `border-border`)
- **Fonts/effects:** DM Mono (body), Instrument Serif (headings); film grain canvas (landing), GSAP scroll animations, marquee ticker; sonner toasts
- **Lists:** long matrices use `content-visibility: auto` so off-screen rows skip render/layout

---

## 4. API Surface

### 4.1 Client → Server

Capability routes go browser→server directly (uploads + SSE never transit Vercel) with a signed `x-attribution` token (`?attribution=` for downloads); everything user-scoped transits the `/api/service` identity proxy.

| Endpoint | Method | Purpose | Timeout |
|---|---|---|---|
| `/api/scan-video` | POST | Upload video, detect players, return session token + video_key | 120s (upload) / 180s (engine) |
| `/api/scan-intent` | POST | Mint a direct-upload slot (multipart or presigned S3) | 30s |
| `/api/scan-from-key` | POST | Scan after a direct upload (strict `raw/…` key) | 180s |
| `/api/scan-progress/:sessionToken` | GET | SSE stream of scan progress (proxied from engine, per-angle) | — |
| `/api/analyze-video` | POST | Enqueue analysis job, return job ID (tier priority) | 30s |
| `/api/job-status/:jobId` | GET | Poll job progress (state, stage, summary, video_ready, findings); Supabase fallback when Redis expires | 15s |
| `/api/download/:jobId` | GET | Stream annotated video (inline; via Next.js `/api/download` rewrite) | — |
| `/api/chat` | POST | Send one message to AI coach (non-streaming) | 60s |
| `/api/chat/stream` | POST | SSE streaming chat (token-by-token) | 120s |
| `/api/conversation/:jobId` | GET | Load in-memory (Redis) conversation history | 10s |
| `/api/auth/sync` | POST | Upsert Auth0 user into `users` | 10s |
| `/api/auth/user/:auth0Id` | GET | Fetch user record | 10s |
| `/api/auth/user/:auth0Id/analyses` | GET | Paginated analysis history (limit ≤ 100, default 20) | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId` | GET/PATCH/DELETE | Detail / rename (`display_name`) / cancel+delete (audited) | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId/cancel` | POST | Cancel an in-progress job | 10s |
| `/api/auth/user/:auth0Id/stats` | GET | Aggregate stats (total/completed/in-progress/failed, downloads) | 10s |
| `/api/auth/user/:auth0Id/findings/trends` | GET | Per-day finding counts by category (needs-review split) | 10s |
| `/api/auth/user/:auth0Id/findings/:findingId` | PATCH | Approve/flag a finding | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId/clips` | GET/POST/DELETE | Clip bookmarks | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId/stages` | GET | Internal stage history | 10s |
| `/api/auth/user/:auth0Id/analyses/:jobId/chat` | GET/POST | Persisted chat history / send message (keyword fallback when engine is down) | 10s/30s |
| `/api/org/:auth0Id/students` (+ import, detail, analyses, performance, wellness) | CRUD | Roster management | 10s |
| `/api/org/:auth0Id/teams` (+ members) | CRUD | Team management | 10s |
| `/api/org/:auth0Id/members` (+ invites, roles, audit) | CRUD | Staff + single-use token invites + audit log | 10s |
| `/api/org/:auth0Id/attendance` (+ batch) | CRUD | Attendance records | 10s |
| `/api/org/:auth0Id/schedule` | CRUD | Schedule events | 10s |
| `/api/org/:auth0Id/reports` (+ compare, AI enqueue/poll) | CRUD | Reports + one-click AI reports | 10s/120s |
| `/api/org/:auth0Id/objectives` `/plans` `/wellness` `/performance` `/overview` `/search` | CRUD/GET | Objectives kanban, training plans, wellness (medical-gated), metrics, overview aggregate, search | 10s |
| `/api/org/:auth0Id/seasons` `/matches` | CRUD | Seasons + matches (compete) | 10s |
| `/api/org/:auth0Id/analyses/:jobId/share-token` (+ list/revoke) | POST/GET/DELETE | Time-limited share links | 10s |
| `/api/share/:token` | GET | Public shared-analysis view (unguarded) | 10s |
| `/api/sports/:sport/positions` | GET | Per-sport positions vocab (guard-exempt, cached, fail-open) | 10s |
| `/api/email/:auth0Id/{invite,report,attendance}` | POST | Resend delivery (501 `EMAIL_NOT_CONFIGURED` without key) | 30s |
| `/api/me/*` | GET/POST | Player self-scoped hub (profile, orgs, analyses, attendance, schedule, performance, objectives, reports, invites, notifications, analyze, attribution mint) | 10s |

> **Note:** `/api/rename/:jobId`, `/api/conversations` (list), `DELETE /api/conversations/:jobId`,
> and `/api/dashboard` are documented in older revisions but **do not exist**. Rename is the
> auth-scoped PATCH above; dashboard data comes from the org/user endpoints.

### 4.2 Server → Engine

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /scan` | Forward video upload, run player detection |
| `POST /upload-intent` | Mint direct-upload slot (multipart or presigned S3) |
| `POST /scan-from-key` | Scan after a direct upload |
| `GET /scan-progress/{session_token}` | SSE scan progress feed (per-angle) |
| `POST /analyze` | Trigger synchronous analysis (BullMQ worker calls this, 12-min timeout) |
| `GET /status/:jobId` | Read job status from engine Redis |
| `GET /download/:jobId` | Stream video file from engine storage (inline local / 302 presigned S3) |
| `POST /fail/:jobId` | Mark a job as failed |
| `POST /chat` | Chat with AI coach (non-streaming) |
| `POST /chat/stream` | SSE streaming chat |
| `POST /report` | Structured JSON report (AI reports) |
| `GET /sports/{sport}/positions` | Per-sport positions vocab |

### 4.3 Engine Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /scan` | Upload video, detect players, create session, return video_key |
| `POST /upload-intent` | Mint direct-upload slot (validated metadata → namespaced key) |
| `POST /scan-from-key` | Scan after a direct upload |
| `GET /scan-progress/{session_token}` | SSE stream for live scan progress (per-angle) |
| `POST /analyze` | Run full analysis pipeline (sync, called by BullMQ) |
| `GET /status/:jobId` | Read job status from Redis |
| `GET /download/:jobId` | Stream video from storage (inline local / 302 presigned S3) |
| `POST /chat` | Chat with AI coach about an analysis (non-streaming) |
| `POST /chat/stream` | SSE streaming chat |
| `POST /report` | Structured JSON report from report context |
| `POST /fail/:jobId` | Mark a job as failed (called by server on BullMQ exhaustion) |
| `GET /sports/{sport}/positions` | Roster vocab from `sports/*.json` (unknown sport → `[]`) |
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
1. Frontend POST /api/analyze-video (or signed-in POST /api/me/analyze)
2. Server creates server_job_id + engine_job_id, stamps owner subs
3. Server saves mapping to Redis (coachai:srv:<uuid>, 2h TTL)
4. Server enqueues to BullMQ (coachai-analysis, attempts: 3, priority: signed-in 10 / anonymous 0 + tier bump)
5. Server returns { job_id: server_job_id }
6. BullMQ worker picks up job (WORKER_CONCURRENCY, default 1)
7. Worker calls POST /analyze on engine (12-min timeout; stuck jobs fail at 13 min)
8. Engine creates job in its Redis (coachai:job:<uuid>, 2h TTL)
9. Engine runs analysis pipeline (with stage resume on retry)
10. Engine updates Redis at each stage; server double-persists completion to Supabase
11. Frontend polls GET /api/job-status/:jobId
12. Server reads engine status (Supabase fallback when Redis expires), medical-redacts
13. Server returns status to frontend
14. On completion: findings persist (idempotent replace), frontend shows results
```

### 5.3 Data Flow for Analysis

```
Video upload (multipart or presigned direct → raw/{session}/{angle}/{uuid}.mp4)
    │
    ▼
Engine stores to storage backend (local disk or S3)
    │
    ▼
Player detection (HOG + MediaPipe pose)
    │
    ▼
Keyframe extraction (3s intervals, max 30 frames; >240s videos chunk via CLI path)
    │
    ▼
Frame scoring (0.4 × visibility + 0.6 × motion)
    │
    ▼
Top 30 frames → Gemini API (multimodal: images + metadata text, 10-min deadline)
    │
    ▼
Gemini returns structured JSON (shots, session_summary)
    │
    ▼
normalize_gemini_result() → frontend AnalysisSummary format (+ stat recount/correction)
    │
    ▼
Derive evidence findings (severity/confidence/evidence frames; low-evidence → needs_review)
    │
    ▼
Pre-render quality gate (stamps summary.quality, never blocks)
    │
    ▼
Render annotated video (pose overlays, HUD, summary screen)
    │
    ▼
Upload to storage (results/{job}.mp4), mark job complete, persist findings
```

### 5.4 State Management

- **Frontend:** `usePipeline()` over `useScanFlow()` custom hooks with `useState`/`useRef`. No external state library.
- **Server → Engine mapping:** Redis `coachai:srv:<uuid>` (2h TTL, owner-bound)
- **Engine job state:** Redis `coachai:job:<uuid>` (2h TTL)
- **Analysis cache:** Redis `coachai:analysis:<hash>:p<player>` (24h TTL)
- **Dedup:** in-memory per video hash (300s)
- **Rate limiting:** 8 Redis buckets (scan 10/min, analysis 5/hr, chat 30/hr, download 60/hr, scan-progress 30/min, clips 60/hr, email 20/day/org, AI reports 10/hr/org), in-memory fallback
- **BullMQ:** two queues (`coachai-analysis` + `coachai-report`), attempts: 3, exponential 5s backoff
- **Retention:** daily sweep prunes analyses + findings + clips + player events + chat older than `RETENTION_DAYS` (default 365)

---

## 6. Supported Sports

Gemini auto-detects the sport unless forced via the `sport` parameter; per-sport
positions, camera-angle guidance, scoring rules, and form criteria live in
`sports/*.json` (basketball is pack v1, the rest v2).

| Sport | Result values scored |
|---|---|
| **Basketball** | made, missed (shots, 3-pointers, layups tracked) |
| **Football** | goal, missed, saved, offside, blocked |
| **Cricket** | four, six, boundary, wicket, dot ball, singles, twos, threes |
| **Tennis** | winner, error, in play, ace, double fault |
| **Baseball** | hit, out, error, walk, strikeout, home run |
| **Hockey** | goal, save, missed, blocked, post |

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
| **Client** | `INVALID_TYPE`, `FILE_TOO_LARGE`, `NETWORK_ERROR`, `REQUEST_FAILED`, `REQUEST_TIMEOUT`, `UPLOAD_FAILED`, `SCAN_PROGRESS_FAILED`, `CHAT_FAILED`, `PARSE_ERROR` |
| **Server** | `RATE_LIMITED`, `QUEUE_UNAVAILABLE`, `INVALID_REQUEST`, `NO_FILE`, `INVALID_FILE_TYPE`, `INVALID_SESSION_TOKEN`, `INVALID_PLAYER_INDEX`, `ANALYSIS_FAILED`, `EMAIL_NOT_CONFIGURED`, `EMAIL_SEND_FAILED` |
| **Engine** | `NO_PLAYERS_DETECTED`, `VIDEO_DECODE_FAILED`, `VIDEO_EXPIRED`, `VIDEO_NOT_FOUND`, `GEMINI_QUOTA_EXCEEDED`, `GEMINI_TIMEOUT`, `GEMINI_PARSE_FAILED`, `GEMINI_PROCESSING_FAILED`, `REDIS_UNAVAILABLE`, `INTERNAL_ERROR`, `JOB_NOT_FOUND`, `ENGINE_UNAVAILABLE`, `ENGINE_ERROR`, `MEDIAPIPE_UNAVAILABLE`, `STORAGE_ERROR`, `INVALID_REQUEST`, `INVALID_STATE_TRANSITION` |
| **Poller** | `ANALYSIS_TIMEOUT` (client poller gives up), `JOB_NOT_FOUND` (session/job expired) |

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
| Engine | Render (starter, paid) | coach-xyz-engine.onrender.com |
| Database | Supabase (free tier) | tocfriargasmbpufmxzg.supabase.co |
| Queue | Upstash Redis (free tier) | — |

### 8.2 Free-Tier Constraints

- **Render server (free):** Spins down after 15 min inactivity. Kept warm by the keepalive workflow
  (`.github/workflows/keepalive.yml` pings `/health` every 9 min) so the BullMQ worker never stalls —
  the engine is on a paid plan, so the server can use the full ~720 h/mo of the 750 h free budget.
  If the keep-alive is removed, expect ~1 min cold starts and stalled queued jobs until the next request.
- **Render engine (starter):** Paid plan required — free tier's 15min spin-down kills in-flight background analyses and wipes `/tmp/storage`. Local-backend videos are still lost on deploy/restart (use `STORAGE_BACKEND=s3` for durable storage).
- **Upstash free tier:** 10,000 commands/day, 256MB storage
- **Supabase free tier:** 500MB database, pausing after inactivity
- **Vercel free tier:** 100GB bandwidth/month

### 8.3 Keep-Alive Strategy

Only the **server** is kept alive externally (it hosts the queue workers); the engine is paid and stays up on its own. The frontend also pings while the pipeline is mounted.

| Component | Interval | Target |
|---|---|---|
| keepalive → Server | 9 min | `GET /health` (GitHub Actions cron) |
| Pipeline → Server | 8 min | `GET /health` (while `usePipeline` mounted) |
| Engine session eviction | 5 min | In-memory cleanup (2h TTL, 10-session cap) |
| BullMQ stuck recovery | 10 min sweep | Jobs active > 13 min → fail (1 min buffer over 12-min timeout) |
| Retention prune | 24 h sweep | Analyses + findings + clips + player events + chat past `RETENTION_DAYS` |

---

## 9. Security

- **Auth:** Auth0 (Google + GitHub social login) via `@auth0/nextjs-auth0`. `/dashboard/*`, `/player`, and `/account` redirect to `/auth/login` when unauthenticated. User-scoped APIs sit behind the verified identity boundary (`x-service-token` + `x-verified-auth0-id`, plus org-role guards and a 14-permission vocabulary); browser-direct scan/analyze attribution uses a signed `x-attribution` token minted at `/api/me/attribution/mint` — a raw `x-auth0-id` header is never trusted (see ARCHITECTURE.md §6).
- **CORS:** Configured for `FRONTEND_URL` origin only (server) and `SERVER_URL` origin (engine)
- **CSP:** Strict Content-Security-Policy header on both Next.js and Elysia
- **HSTS:** Strict-Transport-Security enabled (Next.js always; Elysia when serving over HTTPS)
- **Rate limiting:** 8 buckets — scan 10/min, analysis 5/hr, chat 30/hr, download 60/hr, scan-progress 30/min, clips 60/hr, email 20/day/org, AI reports 10/hr/org (atomic Redis increments, in-memory fallback)
- **Fair queueing:** per-org daily analysis cap (`ORG_DAILY_ANALYSIS_LIMIT`, default 50) + signed-in/tier job priority
- **File validation:** MIME type check, ffprobe media inspection at scan, 500MB size limit (413 on oversized Content-Length)
- **Sentry:** Integrated on all three layers (frontend, server, engine)

---

## 10. What's Missing (Known Gaps)

| Gap | Impact | Status |
|---|---|---|
| No conversational follow-up | User gets one analysis, can't ask questions | ✅ Implemented — streaming + persisted chat on the analysis detail page |
| No URL routing | Can't share results, back button broken | ✅ Implemented — `/dashboard/analysis/[id]`, share tokens + public `/share/[token]` |
| No page transitions | Jarring state switches | ❌ Open |
| Bare upload UX | Spinner only, no progress percentage | ✅ Implemented — SSE scan progress with rotating status lines + percentage |
| Film grain only on landing | Visual inconsistency across screens | ❌ Open (marketing always-dark vs themed app is intentional) |
| No breadcrumbs | User doesn't know where they are in the flow | ✅ Implemented — `PageHeader` trail on every page + ⌘K palette |
| Single-player analysis only | Can't compare players or track progress over time | ⚠️ Partial — per-student analyses + comparison + performance trends exist; no multi-player joint analysis |
| No history browsing | Past analyses not accessible from UI | ✅ Implemented — `/dashboard/history` with pagination |
| No export/share | Can't share results link or export PDF report | ✅ Implemented — share links, findings CSV export, print/email reports, AI reports |
| `/dashboard/analysis/[id]` page won't build | AnalysisDetailClient imported 17 nonexistent `@/components/interior/*` components; `next build` failed. | ✅ Fixed — the `interior/` component library exists; `next build` + `tsc` pass |
