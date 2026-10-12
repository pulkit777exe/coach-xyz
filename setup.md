# Coach-XYZ Setup Instructions

## Overview

This document explains how to run the Coach-XYZ system locally. The project has three tiers:

- **`engine/`** — Python (3.11+ locally, 3.12-slim in Docker) + FastAPI video-analysis pipeline (MediaPipe + Gemini)
- **`server/`** — Bun + Elysia middleware (BullMQ workers, Redis, Supabase persistence)
- **`web-next/`** — Next.js 16 + React 19 frontend (npm, not bun)

There is **no Android / React Native app** and no `backend/`, `web/`, or root `cli/` directory anymore.
The CLI tool lives at `engine/cli/`.

## Prerequisites

- Docker (recommended) — dev setup is driven by `docker-compose.yml`
- Python 3.11+ (for non-Docker engine; Docker uses 3.12-slim)
- Bun 1.x (for non-Docker server)
- Node 22 + npm (for the frontend; web-next uses npm, CI uses `npm ci`)

## Quick start (Docker)

```bash
cp .env.prod.example .env
# Fill in GEMINI_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
docker compose up --build
```

- Engine: http://localhost:8001 (`/health`)
- Server: http://localhost:8000 (`/health`, Swagger at `/swagger`)

The server depends on the engine being healthy and will wait (`condition: service_healthy`).

## Local setup (without Docker)

### 1. Engine (Python)

```bash
cd engine
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.sample .env            # fill in GEMINI_API_KEY, UPSTASH_REDIS_*
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Required env: `GEMINI_API_KEY` (engine startup fails without it). Redis (Upstash) is used for
job state, caching, and rate limiting; if unset, the engine still runs but job status is degraded.

Run the test suite:

```bash
python -m pytest tests/ -q
```

### 2. Server (Bun + Elysia)

```bash
cd server
bun install
cp .env.example .env           # fill in UPSTASH_REDIS_*, optional DATABASE_URL, SENTRY_DSN
bun run dev                    # or bun run start
```

Required env: `ENGINE_URL` (`http://localhost:8001` by default). `DATABASE_URL` is optional —
history/chat persistence degrades gracefully when absent. Rate limits default to
scan 10/min, analysis 5/hr, chat 30/hr, download 60/hr, scan-progress 30/min,
clips 60/hr, email 20/day per org, AI reports 10/hr per org (see `server/.env.example`).
`RETENTION_DAYS` (default 365) drives the daily prune sweep; `ORG_DAILY_ANALYSIS_LIMIT`
(default 50) caps analyses per org per UTC day; `WORKER_CONCURRENCY` (default 1)
sizes the analysis worker.

### 3. Frontend (Next.js)

```bash
cd web-next
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_API_URL, Auth0 vars, NEXT_PUBLIC_SENTRY_DSN, SERVICE_TOKEN
npm run dev
```

Frontend: http://localhost:3000

Auth0 is required for `/dashboard/*`, `/account`, and authenticated uploads. Minimal vars:
`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (64-hex),
`APP_BASE_URL=http://localhost:3000`.

`SERVICE_TOKEN` must match the server's value — it authenticates the identity-bearing
proxy (`web-next/app/api/service/[[...path]]/route.ts`) to the server. Unset only in local dev,
where the server guard is inert and logs a warning on startup. See ARCHITECTURE.md §6.

## Root orchestration

The repo-root `package.json` drives both TypeScript apps (the engine stays separate):

```bash
npm run dev          # node .scripts/dev.mjs: server (:8000) + web (:3000)
npm run check        # typecheck + lint + tests + format check (both TS apps)
npm run typecheck    # server tsc + web tsc
npm run lint         # server eslint + web eslint
npm run test         # server bun test + web vitest
npm run build        # web next build
npm run smoke        # server live HTTP smoke (needs .env + running server + Neon DB)
```

Per-app: `npm run dev:server`, `npm run dev:web`. Server uses `bun`, web-next uses `npm`.

## Environment variables

| Variable | Where | Default | Required |
|---|---|---|---|
| `GEMINI_API_KEY` | engine | — | yes |
| `GEMINI_MODEL` | engine | `gemini-2.5-flash` | no |
| `GEMINI_ANALYSIS_TIMEOUT_S` / `CHAT_GEMINI_TIMEOUT_S` / `FFMPEG_TIMEOUT_S` | engine | `600` / `100` / `300` | no |
| `STORAGE_BACKEND` | engine | `local` (`s3` for S3-compatible buckets) | no |
| `LOCAL_STORAGE_DIR` | engine | `./tmp/storage` | no |
| `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT_URL` (+ AWS creds) | engine | — | yes (when `STORAGE_BACKEND=s3`) |
| `SERVICE_TOKEN` | engine + server + web-next | — | recommended (identity boundary; inert if unset) |
| `SERVER_URL` | engine | `http://localhost:8000` (CORS) | no |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | engine + server | — | recommended |
| `UPSTASH_REDIS_IOREDIS_URL` | server | derived from the REST pair | no (local Redis override) |
| `ENGINE_URL` | server | `http://localhost:8001` | yes |
| `FRONTEND_URL` | server | `http://localhost:3000` (CORS) | no |
| `PORT` | server | `8000` | no |
| `WORKER_CONCURRENCY` / `REPORT_WORKER_CONCURRENCY` | server | `1` / `1` | no |
| `SCAN_RATE_LIMIT` | server | `10` (per minute) | no |
| `ANALYSIS_RATE_LIMIT` | server | `5` (per hour) | no |
| `CHAT_RATE_LIMIT` / `DOWNLOAD_RATE_LIMIT` | server | `30` / `60` (per hour) | no |
| `SCAN_PROGRESS_RATE_LIMIT` / `CLIP_RATE_LIMIT` | server | `30` (per min) / `60` (per hour) | no |
| `EMAIL_RATE_LIMIT` / `AI_REPORT_RATE_LIMIT` | server | `20` (per day/org) / `10` (per hour/org) | no |
| `RETENTION_DAYS` | server | `365` (min 30) | no |
| `ORG_DAILY_ANALYSIS_LIMIT` | server | `50` (per org per UTC day) | no |
| `DATABASE_URL` | server | — | no (graceful degradation) |
| `RESEND_API_KEY` (+ `RESEND_FROM_DOMAIN/NAME`) | server | — | no (email routes return 501 `EMAIL_NOT_CONFIGURED` when unset) |
| `SENTRY_DSN` | engine + server + web | — | no |
| `NEXT_PUBLIC_API_URL` | web-next | `http://localhost:8000` | yes |
| Auth0 vars (`AUTH0_*`, `APP_BASE_URL`) | web-next | — | yes (for auth) |

Storage is **local by default** (`LOCAL_STORAGE_DIR`) with an **S3-compatible
backend** (`STORAGE_BACKEND=s3`) for shared/production storage: immutable
`raw/{session}/{angle}/{uuid}.mp4` sources plus one `results/{job}.mp4` per
analysis, with presigned browser-direct uploads (`POST /upload-intent` →
`POST /scan-from-key`).

## VSCode Tasks

`.vscode/tasks.json` wires up Docker-compose tasks for engine + server + frontend (build/up/logs).
Open the Command Palette (`Ctrl+Shift+P`) → "Tasks: Run Task" to use them.

## Usage

1. Open http://localhost:3000
2. Upload a video (MP4/MOV/AVI/MKV, ≤500 MB). The system detects players and either auto-analyses
   single-player clips or asks you to pick a player.
3. Wait for analysis (30–120s), then view results and chat with the AI coach.
4. Download the annotated video from the results or dashboard detail page.

## Coach dashboard & player hub

Accounts have a `role` (`coach` | `player`), defaulting to `coach` on first login:

- **Coach** — `/dashboard/*`: role-differentiated home, Students (roster CRUD, CSV import, invites, teams), Teams, Members (staff roles + single-use token invites), Audit log, Attendance grid + batch entry, Schedule calendar, Objectives kanban, Training plans, Wellness check-ins (medical-gated), Reports (print/email/AI-generated) + detail, Analyses history + detail + chat + findings + clips, Search (⌘K palette + global), Settings (profile, preferences, org).
- **Player** — `/player`: read-only self view (own analyses + uploads, attendance, performance, reports, objectives, team schedule). A player's login email auto-links to their `students` row on first login (`students.account_auth0_id`), flipping the role to `player`; the dashboard then redirects them to `/player`.

Role enforcement lives in the server guard (`serviceGuard.ts` + `permissions.ts`,
14-permission vocabulary over org roles owner/admin/head_coach/assistant_coach/
coach/analyst/medical/player); the UI gates (`app/dashboard/layout.tsx`,
`app/player/page.tsx`, `lib/nav.ts`) are UX-layer only.

## Test suites

```bash
cd engine   && python -m pytest tests/ -q   # 207 tests
cd server   && bun test                      # 354 pass / 30 files (incl. admission, orgSubdomains, workerLifecycle, jobGuard, chatTurn)
cd web-next && npm test                      # 180 tests / 18 files (vitest, incl. dataCore, pipelineFlow)
```

Or run everything TypeScript with `npm run check` from the repo root (adds
`tsc --noEmit`, eslint, and prettier checks). The live smoke suite
(`server/scripts/smokeOrgHttp.ts`, 51 checks) needs `.env` + a running server
backed by Neon. DB-integration tests run against the live DB locally (Bun
autoloads `server/.env`) and skip in CI without `DATABASE_URL`. Fully offline?
Blank the infra env (`UPSTASH_REDIS_REST_URL/_TOKEN` + `DATABASE_URL` empty):
rate limiting falls back to in-memory and DB tests skip — the suite runs green
with no network.

## Supported sports

Gemini auto-detects the sport unless forced via the `sport` parameter; per-sport
positions, camera-angle guidance, and scoring rules live in `sports/*.json`.

| Sport | Result values scored |
|---|---|
| Basketball | made, missed (shots, 3-pointers, layups tracked) |
| Football | goal, missed, saved, offside, blocked |
| Cricket | four, six, boundary, wicket, dot ball, singles, twos, threes |
| Tennis | winner, error, in play, ace, double fault |
| Baseball | hit, out, error, walk, strikeout, home run |
| Hockey | goal, save, missed, blocked, post |

## Architecture

```
coach-xyz/
├── engine/          # Python FastAPI analysis engine (MediaPipe + Gemini, local/S3 storage)
├── server/          # Bun/Elysia middleware (BullMQ workers, org data layer, Supabase history, rate limiting)
├── web-next/        # Next.js 16 frontend (pipeline SPA + coach dashboard + player hub + marketing)
├── sports/          # Per-sport config JSON (events, positions, camera angles, scoring)
├── docs/            # V1 (current app) + V2 (chat) + target-architecture plan + backup/auth0 runbooks
├── docker-compose.yml       # dev compose (engine + server)
├── docker-compose.prod.yml  # hardened prod compose
└── render.yaml              # Render blueprint (engine starter + server free)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full data model and request flows.