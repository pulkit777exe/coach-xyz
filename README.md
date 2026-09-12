<p align="center">
  <samp>
    <b>Coach0</b> · multi-sport AI video analyzer<br>
    <sub>personal project · open source · built with next.js, elysia, fastapi, gemini</sub>
  </samp>
</p>

---

Upload any basketball, football, cricket, tennis, baseball, or hockey video — get instant form scores, shot-by-shot coaching feedback, a professionally annotated video, and a chat with the AI coach for follow-up questions.

Powered by **Google Gemini AI** + **MediaPipe** pose detection.

## Features

- Upload → detect players → auto-analyze → annotated MP4 with pose overlays, HUD, and summary screen
- Conversational follow-up: chat with an AI coach about the analysis (streaming), with timestamp references that seek the video
- Dashboard with history, stats, per-analysis detail, rename, and persisted conversations
- Auth0 login (Google / GitHub), per-user history and chat persistence (Supabase)
- 6 sports with per-sport scoring rules

## Tech

next.js, typescript, tailwind css, elysia/bun, fastapi, bullmq, google gemini, mediapipe, opencv, upstash redis, supabase postgresql, auth0, sentry, docker

## Quick start

### Option A: Docker (recommended)

```bash
docker compose up
```

Starts the Python analysis engine and the Elysia server. See [ARCHITECTURE.md](./ARCHITECTURE.md) for environment setup, or [setup.md](./setup.md) for a full walkthrough.

### Option B: Local setup

```bash
# Engine (Python 3.11)
cd engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.sample .env   # add GEMINI_API_KEY + Upstash Redis vars

# Server (Bun)
cd ../server
bun install
cp .env.example .env
bun run dev

# Frontend (Next.js)
cd ../web-next
bun install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL + Auth0 vars
bun run dev
```

Frontend at `:3000`, server at `:8000`, engine at `:8001`.

> Auth0 credentials are required for `/dashboard` and `/account`. See [setup.md](./setup.md).

## Project

```
├── web-next/      Next.js 16 + React 19 frontend
├── server/        Elysia/Bun middleware + BullMQ job queue
├── engine/        FastAPI video analysis pipeline (Gemini + MediaPipe)
├── sports/        Per-sport config JSON
├── docs/          V1 (current app) + V2 (chat) feature docs
├── ARCHITECTURE.md / SCALING.md / setup.md
└── docker-compose.yml
```

| Layer | What it does |
|---|---|
| `web-next/` | SPA — upload video, pick player, poll progress, chat with AI coach, dashboard/history |
| `server/` | Rate limiting (scan 10/min, analysis 5/hr), Auth0 user sync, BullMQ orchestration, Supabase history |
| `engine/` | Player detection, Gemini analysis, video annotation, caching, chat (streaming) |
| `sports/` | Sport-specific event definitions and scoring rules |

Engine tests: `cd engine && python -m pytest tests/ -q`

## Supported sports

| Sport | Events detected |
|---|---|
| Basketball | Jump shots, layups, dunks, free throws, 3-pt |
| Football | Strikes, headers, volleys, penalties |
| Cricket | Drives, pulls, sweeps, cuts, hooks |
| Tennis | Serves, forehands, backhands, volleys, overheads, drop shots |
| Baseball | Singles, doubles, home runs, strikeouts |
| Hockey | Wrist shots, slap shots, backhands, one-timers |

## Output

Every analysis produces:

1. **Event JSON** — structured event data (timestamps, form scores, feedback, session summary)
2. **Annotated MP4** — original video with AI overlays baked in

## License

No LICENSE file is present in the repository yet.
