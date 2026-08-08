PROJECT: CoachAI — Multi-sport AI video analysis platform

STACK:
- Frontend: Next.js (web-next/)
- Backend API: Elysia + Bun (server/src/)
- AI Engine: Python, MediaPipe, Gemini (engine/)
- Mobile: React Native (android/ — does not exist yet)
- Sport configs: JSON (sports/)

ARCHITECTURE RULE:
The Python engine is the only layer that touches
MediaPipe and Gemini. Elysia does NOT call Gemini
directly. Elysia calls the Python engine via
internal HTTP or spawns engine processes.
Next.js talks only to Elysia — never to the
Python engine directly.

LAYER SEAMS:
- engine/api/ — Route modules (health, scan, analyze, chat, download) + sessions.py
- engine/core/ — Pure business logic (analyzer, detector, renderer, jobs, etc.)
- server/src/lib/ — Orchestration (queue, redis, jobs, ratelimit, serviceRegistry)
- server/src/routes/ — HTTP handlers (scan, analyze, status, download, chat, auth, health)
- web-next/lib/ — Client state (usePipeline) and API client
- web-next/components/ — UI rendering

CURRENT SINGLE-PLAYER FLOW:
Next.js uploads video → Elysia /api/analyze →
Python engine processes → Elysia polls engine →
Next.js polls Elysia /api/jobs/{id} → results rendered

PIPELINE STATE MACHINE:
- Engine is source of truth: engine/core/jobs.py (PIPELINE_STATES, VALID_TRANSITIONS)
- Schema exposed at: GET /pipeline-schema
- States: uploading → scanning → player_selection → analyzing → rendering → completed (or → failed)
- Server mirrors: server/src/types/index.ts (EnginePipelineState)
- Frontend mirrors: web-next/types/index.ts (EnginePipelineState + PipelineState)

SERVICE STATUS:
- server/src/lib/serviceRegistry.ts tracks: redis, queue, history_store
- GET /health/deep returns full services map
- All adapters report live/degraded/disabled transitions

WHAT MUST NOT BREAK:
- All existing Elysia routes in server/src/routes/
- All existing Next.js pages and components in web-next/
- The Python engine's existing single-player pipeline
- Android app (untouched until web is validated)
- The /pipeline-schema contract (engine → server → frontend)

MULTI-PLAYER ADDS ONE NEW STEP:
Upload → [NEW: Player Selection] → Analysis → Results
