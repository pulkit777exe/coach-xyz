<p align="center">
  <samp>
    <b>Coach0</b> · multi-sport AI video analyzer<br>
    <sub>personal project · open source · built with next.js, elysia, fastapi, gemini</sub>
  </samp>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

---

Upload any basketball, football, cricket, tennis, baseball, or hockey video — get instant form scores, shot-by-shot coaching feedback, and a professionally annotated video.

Powered by **Google Gemini AI** + **MediaPipe** pose detection.

## Tech

next.js, typescript, tailwind css, elysia/bun, fastapi, bullmq, google gemini, mediapipe, opencv, upstash redis, supabase postgresql, docker

## Quick start

### Option A: Docker (recommended)

```bash
docker compose up
```

Starts the Python analysis engine and the Elysia server. See [ARCHITECTURE.md](./ARCHITECTURE.md) for environment setup.

### Option B: Local setup

```bash
# Engine (Python)
cd engine
pip install -r requirements.txt
cd ..

# Server (Bun)
cd server
bun install
cp .env.example .env
# Add GEMINI_API_KEY
bun run dev

# Frontend (Next.js)
cd web-next
bun install
cp .env.local.example .env.local
bun run dev
```

Frontend at `:3000`, server at `:8000`, engine at `:8001`.

## Project

```
├── web-next/      Next.js 16 + React 19 frontend
├── server/        Elysia/Bun middleware + BullMQ job queue
├── engine/        FastAPI video analysis pipeline (Gemini + MediaPipe)
├── sports/        Per-sport config JSON
└── docker-compose.yml
```

| Layer | What it does |
|---|---|
| `web-next/` | SPA — upload video, pick player, poll progress, download result |
| `server/` | Rate limiting, beta codes, job orchestration, Supabase history |
| `engine/` | Player detection, Gemini analysis, video annotation, caching |
| `sports/` | Sport-specific event definitions and scoring rules |

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

MIT — see [LICENSE](./LICENSE).
