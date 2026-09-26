# Coach-XYZ Setup Instructions

## Overview

This document explains how to run the Coach-XYZ system locally. The project has three tiers:

- **`engine/`** — Python 3.12 + FastAPI video-analysis pipeline (MediaPipe + Gemini)
- **`server/`** — Bun + Elysia middleware (BullMQ worker, Redis, Supabase persistence)
- **`web-next/`** — Next.js 16 + React 19 frontend

There is **no Android / React Native app** and no `backend/`, `web/`, or root `cli/` directory anymore.
The CLI tool lives at `engine/cli/`.

## Prerequisites

- Docker (recommended) — dev setup is driven by `docker-compose.yml`
- Python 3.12 (for non-Docker engine)
- Bun 1.x (for non-Docker server; web-next uses npm)

## Quick start (Docker)

```bash
cp .env.prod.example .env
# Fill in GEMINI_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
# Production/Render also requires the operator-managed secrets below.
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
history/chat persistence degrades gracefully when absent. In production (`NODE_ENV=production`),
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are required for BullMQ and the
cross-replica report/notification event bus. Rate limits are configured with `SCAN_RATE_LIMIT`
(default 10/min) and `ANALYSIS_RATE_LIMIT` (default 5/hour).

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
npm run dev          # parallel: server (:8000) + web (:3000)
npm run check        # typecheck + lint + tests (both TS apps)
npm run typecheck    # server tsc + web tsc
npm run lint         # server eslint + web eslint
npm run test         # server bun test + web vitest
npm run build        # web next build
npm run smoke        # server live HTTP smoke (needs .env + running server + Neon DB)
npm run smoke:events # live Redis/SSE analysis + two-replica report/notification bus smoke
```

Per-app: `npm run dev:server`, `npm run dev:web`. Server uses `bun`, web-next uses `npm`.

## Environment variables

| Variable | Where | Default | Required |
|---|---|---|---|
| `GEMINI_API_KEY` | engine | — | yes |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | engine + server | — | production server: yes; local: recommended |
| `ENGINE_URL` | server | `http://localhost:8001` | yes |
| `FRONTEND_URL` | server | `http://localhost:3000` (CORS) | no |
| `PORT` | server | `8000` | no |
| `WORKER_CONCURRENCY` | server | `1` | no |
| `SCAN_RATE_LIMIT` | server | `10` (per minute) | no |
| `ANALYSIS_RATE_LIMIT` | server | `5` (per hour) | no |
| `DATABASE_URL` | server | — | no (graceful degradation) |
| `SERVICE_TOKEN` | server + web-next | — | recommended (identity boundary; inert if unset) |
| `RESEND_API_KEY` | server | — | no (email routes return 501 `EMAIL_NOT_CONFIGURED` when unset) |
| `SENTRY_DSN` | engine + server + web | — | no |
| `NEXT_PUBLIC_API_URL` | web-next | `http://localhost:8000` | yes |
| Auth0 vars (`AUTH0_*`, `APP_BASE_URL`) | web-next | — | yes (for auth) |

Storage defaults to **local disk** — the engine writes to `/app/tmp/storage` (Docker) or
`engine/tmp/storage` (`LOCAL_STORAGE_DIR`). Opt into the S3-compatible backend with
`STORAGE_BACKEND=s3` + `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT_URL` + standard
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (see `engine/.env.sample`); uploads/downloads
then go through presigned URLs.

### Render deployment

`render.yaml` wires `ENGINE_URL` to the engine service and sets `NODE_ENV=production` for the
server. Before the first deploy, set the operator-managed `sync: false` values in the Render
dashboard: `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`FRONTEND_URL`, `SERVICE_TOKEN`, and any optional Auth0, database, email, and Sentry values. Set
`SERVICE_TOKEN` to the same secret on the engine and server (and web) services. The server fails
fast in production if `ENGINE_URL`, the Redis REST credentials, or the service identity secret are
missing; secrets must never be committed to the repository.

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

- **Coach** — `/dashboard/*`: Overview, Students (roster CRUD, invites, attendance), Attendance grid + batch entry, Schedule calendar, Reports (print/email), Analyses history + detail + chat, Search, Settings (profile, members).
- **Player** — `/player`: read-only self view. A player's login email auto-links to their `students` row on first login (`students.account_auth0_id`), flipping the role to `player`; the dashboard then redirects them to `/player`.

Role enforcement lives in the server guard; the UI gates (`app/dashboard/layout.tsx`, `app/player/page.tsx`) are UX-layer only.

## Test suites

```bash
cd engine   && .venv/bin/python -m pytest tests/ -q   # 228 tests
cd server   && bun test                             # 418 tests / 42 files
cd web-next && npm test                             # 231 tests / 23 files (vitest)
```

These counts are for the current worktree, including the notification-preference integration that is intentionally kept unstaged while the event-transport work is isolated.

Or run both TypeScript suites at once with `npm run check` from the repo root.

## Supported sports

| Sport | Events detected |
|---|---|
| Basketball | Jump shots, layups, dunks, free throws, 3-pt |
| Football | Strikes, headers, volleys, penalties |
| Cricket | Drives, pulls, sweeps, cuts, hooks |
| Tennis | Serves, forehands, backhands, volleys, overheads, drop shots |
| Baseball | Singles, doubles, home runs, strikeouts |
| Hockey | Wrist shots, slap shots, backhands, one-timers |

Sport is auto-detected by Gemini unless forced via the `sport` parameter.

## Architecture

```
coach-xyz/
├── engine/          # Python FastAPI analysis engine (MediaPipe + Gemini)
├── server/          # Bun/Elysia middleware (BullMQ worker, Supabase history, rate limiting)
├── web-next/        # Next.js 16 frontend (upload → analyze → chat)
├── sports/          # Per-sport config JSON (6 sports)
├── docs/            # V1 (current app) and V2 (chat design) feature docs
├── docker-compose.yml       # dev compose (engine + server)
├── docker-compose.prod.yml  # hardened prod compose
└── render.yaml              # Render blueprint (engine + server)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full data model and request flows.