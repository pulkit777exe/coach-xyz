<p align="center">
  <samp>
    <b>CoachXYZ</b> · multi-sport AI video analyzer<br>
    <sub>personal project · open source · built with next.js, elysia, fastapi, gemini</sub>
  </samp>
</p>

---

Upload any basketball, football, cricket, tennis, baseball, or hockey video — get instant form scores, shot-by-shot coaching feedback, a professionally annotated video, and a chat with the AI coach for follow-up questions.

Powered by **Google Gemini AI** + **MediaPipe** pose detection.

## Features

- Upload → detect players → auto-analyze → annotated MP4 with pose overlays, HUD, and summary screen (multi-angle sessions supported)
- Evidence findings per event (severity, confidence, evidence frames, needs-review gate) with click-to-seek timeline + video clips
- Conversational follow-up: streaming chat with an AI coach about the analysis, with timestamp references that seek the video
- Coach dashboard: roster + teams + members/invites/audit, attendance grid + batch entry, schedule/calendar, objectives kanban, training plans, wellness check-ins, printable/emailable reports, per-student performance, one-click AI reports, global search, share links
- Player hub: read-only self view (own analyses, attendance, performance, reports, objectives, team schedule) linked by login email; players can run their own uploads
- Auth0 login (Google / GitHub), per-user history and chat persistence (Supabase), notifications (SSE + bell)
- 6 sports with per-sport scoring rules, positions vocab, and camera-angle guidance

## Tech

next.js 16, react 19, typescript, tailwind css v4, elysia/bun, fastapi, bullmq, google gemini (2.5-flash), mediapipe, opencv, upstash redis, supabase postgresql, auth0, sentry, docker

## Quick start

### Option A: Docker (recommended)

```bash
docker compose up
```

Starts the Python analysis engine and the Elysia server. See [ARCHITECTURE.md](./ARCHITECTURE.md) for environment setup, or [setup.md](./setup.md) for a full walkthrough.

### Option B: Local setup

Run everything from the repo root — the root `package.json` orchestrates both TS apps:

```bash
# from repo root
npm install                  # root tooling
(cd server && bun install)
(cd web-next && npm install)

# Engine (Python 3.11) — no root orchestration
cd engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.sample .env   # add GEMINI_API_KEY + Upstash Redis vars

# Back to root — starts server (:8000) + web (:3000) in parallel
cd ..
npm run dev
```

Per-app scripts: `npm run dev:server`, `npm run dev:web`. Checks: `npm run check` (typecheck + lint + tests + format check, both TS apps), `npm run build` (web), `npm run smoke` (server live HTTP, needs `.env` + running server).

Frontend at `:3000`, server at `:8000`, engine at `:8001` (start the engine separately, above).

> Auth0 credentials are required for `/dashboard`, `/player`, and `/account`. See [setup.md](./setup.md).

## Project

```
├── web-next/      Next.js 16 + React 19 frontend
├── server/        Elysia/Bun middleware + BullMQ job queues
├── engine/        FastAPI video analysis pipeline (Gemini + MediaPipe)
├── sports/        Per-sport config JSON (events, positions, camera angles, scoring)
├── docs/          V1 (current app) + V2 (chat) + target-architecture plan + runbooks
├── ARCHITECTURE.md / SCALING.md / setup.md
└── docker-compose.yml
```

| Layer | What it does |
|---|---|
| `web-next/` | Next.js App Router — coach dashboard (roster, teams, attendance, schedule, reports, objectives, history) + read-only player hub + marketing site |
| `server/` | Tiered rate limiting, Auth0 user sync, org data layer (students/teams/members/attendance/schedule/reports/objectives/plans/wellness/performance), BullMQ orchestration, findings/clips/share/notifications/AI reports, email (Resend), Supabase history |
| `engine/` | Player detection, Gemini analysis, evidence findings, video annotation, local/S3 storage, caching, streaming chat |
| `sports/` | Sport-specific event definitions, positions, camera-angle guidance, scoring rules |

Tests: `cd engine && python -m pytest tests/ -q` · `cd server && bun test` · `cd web-next && npm test` · or all of the TS apps with `npm run check` from the root. Baselines: server 354 pass / 30 files · web 180 tests / 18 files · engine 207 tests (verified green 2026-10-11).

## Supported sports

Gemini auto-detects the sport (or force it via the `sport` parameter) and scores
per-event results; per-sport positions, camera-angle guidance, and scoring rules
live in `sports/*.json`.

| Sport | Result values scored |
|---|---|
| Basketball | made, missed (shots, 3-pointers, layups tracked) |
| Football | goal, missed, saved, offside, blocked |
| Cricket | four, six, boundary, wicket, dot ball, singles, twos, threes |
| Tennis | winner, error, in play, ace, double fault |
| Baseball | hit, out, error, walk, strikeout, home run |
| Hockey | goal, save, missed, blocked, post |

## Output

Every analysis produces:

1. **Event JSON** — structured event data (timestamps, form scores, feedback, session summary)
2. **Evidence findings** — one finding per scored event (severity, confidence, evidence frames, needs-review flag)
3. **Annotated MP4** — original video with AI overlays baked in

## License

No LICENSE file is present in the repository yet.
