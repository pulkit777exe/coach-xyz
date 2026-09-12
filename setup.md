# Coach-XYZ Setup Instructions

## Overview

This document explains how to run the Coach-XYZ system locally. The project has three tiers:

- **`engine/`** — Python 3.11 + FastAPI video-analysis pipeline (MediaPipe + Gemini)
- **`server/`** — Bun + Elysia middleware (BullMQ worker, Redis, Supabase persistence)
- **`web-next/`** — Next.js 16 + React 19 frontend

There is **no Android / React Native app** and no `backend/`, `web/`, or root `cli/` directory anymore.
The CLI tool lives at `engine/cli/`.

## Prerequisites

- Docker (recommended) — dev setup is driven by `docker-compose.yml`
- Python 3.11 (for non-Docker engine)
- Bun 1.x (for non-Docker server + frontend)

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
history/chat persistence degrades gracefully when absent. Rate limits are configured with
`SCAN_RATE_LIMIT` (default 10/min) and `ANALYSIS_RATE_LIMIT` (default 5/hour).

### 3. Frontend (Next.js)

```bash
cd web-next
bun install
cp .env.example .env.local     # set NEXT_PUBLIC_API_URL, Auth0 vars, NEXT_PUBLIC_SENTRY_DSN
bun run dev
```

Frontend: http://localhost:3000

Auth0 is required for `/dashboard/*`, `/account`, and authenticated uploads. Minimal vars:
`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (64-hex),
`APP_BASE_URL=http://localhost:3000`.

## Environment variables

| Variable | Where | Default | Required |
|---|---|---|---|
| `GEMINI_API_KEY` | engine | — | yes |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | engine + server | — | recommended |
| `ENGINE_URL` | server | `http://localhost:8001` | yes |
| `FRONTEND_URL` | server | `http://localhost:3000` (CORS) | no |
| `PORT` | server | `8000` | no |
| `WORKER_CONCURRENCY` | server | `1` | no |
| `SCAN_RATE_LIMIT` | server | `10` (per minute) | no |
| `ANALYSIS_RATE_LIMIT` | server | `5` (per hour) | no |
| `DATABASE_URL` | server | — | no (graceful degradation) |
| `SENTRY_DSN` | engine + server + web | — | no |
| `NEXT_PUBLIC_API_URL` | web-next | `http://localhost:8000` | yes |
| Auth0 vars (`AUTH0_*`, `APP_BASE_URL`) | web-next | — | yes (for auth) |

Storage is **local-only** — the engine writes to `/app/tmp/storage` (Docker) or `engine/tmp/storage`.
The only storage var is `LOCAL_STORAGE_DIR`; there is no S3/R2 integration.

## VSCode Tasks

`.vscode/tasks.json` wires up Docker-compose tasks for engine + server + frontend (build/up/logs).
Open the Command Palette (`Ctrl+Shift+P`) → "Tasks: Run Task" to use them.

## Usage

1. Open http://localhost:3000
2. Upload a video (MP4/MOV/AVI/MKV, ≤500 MB). The system detects players and either auto-analyses
   single-player clips or asks you to pick a player.
3. Wait for analysis (30–120s), then view results and chat with the AI coach.
4. Download the annotated video from the results or dashboard detail page.

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