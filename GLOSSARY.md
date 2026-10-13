# GLOSSARY.md — CoachXYZ domain + architecture terms

Domain terms follow `ARCHITECTURE.md` / `docs/CODEBASE_MAP.md`. Architecture
terms follow the deep-module vocabulary (module, interface, implementation,
depth, seam, adapter, leverage, locality).

## Agreed module names (deepened 2026-10-11 — see docs/CODEBASE_MAP.md)

- **data core** — the one deep web data module owning transport, attribution, error shape, and cache identity (`web-next/lib`).
- **entity facade** — thin per-entity file over the data core preserving direct-path imports (no barrels).
- **scan facade** (`web-next/lib/scan.ts`) — scan → analyze → poll → download flow over the data core.
- **chat facade** (`web-next/lib/chat.ts`) — live + persisted conversation over the data core.
- **user library facade** (`web-next/lib/library.ts`) — dashboard analyses, stats, findings, clips, lifecycle over the data core.
- **user identity facade** (`web-next/lib/user.ts`) — auth sync + profile reads over the data core.
- **pipeline** (unified) — the single module owning upload → scan → analyze → poll → retry phases for coach and player surfaces.
- **admission** — the single server module owning rate → validate → quota → tier → owner-bind → enqueue → persist for analyze entries.
- **entry context** — the one data shape describing an analyze entry (identity, org scope, job payload).
- **worker lifecycle** — the server module owning retry/persist/events/sweeps/shutdown across job kinds.
- **job-kind adapter** — thin plug-in behind the worker lifecycle (`analysis`, `ai-report`).
- **job-guard** — the server module owning analysis/finding ownership, review, and failed-mark checks.
- **chat-turn** — the server module owning one assistant turn (context build, engine call, keyword fallback).
- **page shell** — the single RSC helper owning session + gate + org context + fetchers + fallback for dashboard pages.
- **detection seam** — the one pose-candidate module with tuning options (scan vs tracking presets) (`engine/core`).
- **session registry** — the engine module owning scan-session resolve, scan-result store, progress, eviction, teardown (`engine/core`).
- **analysis driver** — the single staged pipeline (`run_analysis`: tracking → reasoning → scoring → quality → render) crossed by server, CLI, and retries; job state behind a store seam (Redis in prod, local adapter otherwise).
- **user-job adapter** — the server adapter owning the curatorial handler chain (params → guard → store → audit → errors) behind `withUserJob` (`server/src/lib/userJob.ts`).
- **analysis policy** — the server module owning org quota/tier/usage + retention policy, split from the analyses persistence seam (`server/src/lib/analysisPolicy.ts`).
- **org subdomains (web)** — per-domain entity facades under `web-next/lib/org/` (students, attendance, schedule, reports, objectives, findings, compete, plans, wellness, subscription, performance, overview, email) re-exported via the `lib/org.ts` shim.
- **capability kernel** — the server adapter owning the browser-direct route chain (rate gate → job access → engine error map) (`server/src/lib/capability.ts`).
- **player scope** — the server adapter owning the self-scoped chain (verified guard → linked scope → uniform linked handling) (`server/src/lib/playerScope.ts`).
- **scoring** — the engine module owning criterion + weighted-composite form scoring (`engine/core/scoring.py`).
- **biomechanics** — the engine module owning nearest-track metric attach + injury-risk delegation (`engine/core/biomechanics.py`).
- **storage backend** — the engine seam with Local/S3 adapters behind capability methods (`engine/core/storage.py`).
- **crud list** — the shared web hook owning the load → create → setStatus → remove loop (`web-next/lib/useOrgCrudList.ts`).
- **route kernel (engine)** — shared JSON-route preambles in `engine/core/http.py` (content guard, body parse, job lookup, summary check, Gemini map, timestamp refs).
- **curation policy** — pure findings/clips rules in `server/src/lib/findingsPolicy.ts` + `clipsPolicy.ts`, split from the persistence seam (single-transaction `createClip`).
- **notifications split** — store (`notificationsStore.ts`) vs fan-out (`notificationsEvents.ts`) with the shared `queueConnection.ts` IORedis builder.
- **profile data** — `web-next/lib/useStudentProfileData.ts` owning StudentProfile's server-data states + loaders.
- **month navigator** — `web-next/lib/useMonthNavigator.ts` owning the calendar loop (AI-report polling crosses the shared `jobPolling` core).
