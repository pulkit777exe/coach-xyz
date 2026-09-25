# AGENTS.md

Guidance for agents working in this repo. Read `ARCHITECTURE.md` for the data model and request flows; `setup.md` for local setup.

## Project

CoachXYZ — multi-sport AI video analyzer. Three deployable tiers plus shared config:

- `web-next/` — Next.js 16 (App Router) + React 19 + TS + Tailwind v4. Coach dashboard, marketing site, player hub.
- `server/` — Bun 1.x + Elysia. Auth sync, org data layer, BullMQ orchestration, Supabase persistence, email (Resend).
- `engine/` — Python 3.11 + FastAPI. Video analysis pipeline (Gemini + MediaPipe).
- `sports/` — per-sport scoring config JSON. `docs/` — feature docs.

`web-next/proxy.ts` is the Next middleware that forwards `/api/*` to the server.

## Commands

Run from repo root (orchestrated via root `package.json`):

```bash
npm run dev          # parallel: bun dev (server:8000) + next dev (web:3000)
npm run check        # typecheck + lint + tests (both TS apps)
npm run typecheck    # server tsc + web tsc
npm run lint         # server eslint + web eslint
npm run test         # server bun test + web vitest
npm run build        # web next build
npm run smoke        # server live HTTP smoke (needs .env + running server + Neon DB)
```

Per-app: server uses `bun`, engine uses `pip`/`python`, web-next uses `npm` (CI also uses npm).

Test baselines (keep green; re-confirmed 2026-09-25): server `bun test` = 387 pass / 37 files (3 notification DB-integration tests skip unless `DATABASE_URL` reaches a live DB — Bun autoloads `server/.env` locally, so they run against Neon there); web `vitest run` = 225 tests / 22 files; engine `pytest tests -q` = 228 tests; `tsc --noEmit` + eslint clean both TS apps (zero lint warnings), `prettier --check` clean for files added/edited this round (a long tail of pre-existing files was never formatted — don't opportunistically reformat them); `next build` clean; live smoke `server/scripts/smokeOrgHttp.ts` = 51/51 green (re-run 2026-09-25 after the event-driven status migration).

Per-request dedup: RSC pages import data fetchers from `lib/serverData.ts` (React.cache-wrapped) and the session via `lib/session.ts` (`getSession`, React.cache) — never call `lib/org`/`lib/api` fetchers or `auth0.getSession()` directly from pages. `lib/api`/`lib/org` stay for client components, middleware (`proxy.ts`), and route handlers. Heavy client visuals (recharts) load via `next/dynamic` with `ssr: false`.

## Skills

Consulted skill guidance (installed locally, not vendored in the repo):

- `vercel-react-best-practices` — 70 perf rules, priority 1→8 (waterfalls, bundle size, server perf, client fetching, re-render, rendering, JS perf, advanced). Consult `SKILL.md` for the priority table and per-rule files under `rules/` when writing/refactoring React code.
- `nextjs-react-typescript` — TS/Next conventions (RSC bias, mobile-first, Suspense, images).

## Frontend conventions (from the skills, reconciled with repo state)

- **Data fetching**: parallelize independent fetches with `Promise.all` (async-parallel) — including RSC bootstrap pairs (`getSession` + `getOrgContext`, profile + org context). Use `unstable_noStore()` on authenticated dashboard pages serving fresh data; nothing to cache, fetches hit the live API. Prefer server components; add `"use client"` only where Web APIs/interactivity are needed.
- **Web errors**: one mapping rule in `lib/errors.ts` (`errorFromResponse` narrows the any-typed wire body; `engineError` shapes engine-layer failures) — never hand-build `CoachAIError` literals in fetch/XHR/SSE paths; narrowed fields fall back instead of leaking non-strings into the UI.
- **No barrel imports.** Import directly (`@/components/org/ScheduleClient`, not `@/components`). Statically analyzable paths only.
- **Primitives**: use `@/components/9ui/ui/*` (avatar, badge, button, card, chart, checkbox, dialog, dropdown-menu, input, label, select, skeleton, sonner, switch, textarea — vendor more with `npx shadcn@latest add @9ui/<name>`). Legacy `components/ui/*` is deleted — do not resurrect. shadcn-style 9ui where available.
- **Re-render hygiene**: no components defined inside components; no synchronous `setState` in effect bodies (defer via `requestAnimationFrame`, move to event handlers, or derive during render); use functional `setState` and lazy `useState(() => ...)` for expensive init; keep non-trivial derived data in `useMemo` (e.g., `byDay` map in ScheduleClient); use `Map`/`Set` for repeated lookups (not `find` in loops).
- **Conditional rendering**: prefer ternaries over `{x && ...}` when the left side could render a falsy number. Watch `.length`-based conditionals.
- **Styling**: Tailwind classes via the semantic token system in `app/globals.css` (`bg-card`, `text-muted-foreground`, `border-border`) — never raw hex or hand-written `dark:` color pairs in `.tsx`; a theme-varying value is a token (add one value-exact). Marketing pages follow the same light/dark theme (the `--marketing-*` alias layer was deleted). Type sizes: prefer the font-size-only utilities `text-label` (11) `text-caption` (12) `text-meta` (13) `text-body` (14) `text-title` (15) `text-lead` (16) over `text-[Npx]` (adopted first-party-wide; only vendored `components/interior/**` keeps literal six sizes); pinned by `lib/__tests__/typeScale.test.ts`. Details in `docs/DESIGN_FOUNDATIONS.md`. Mobile-first.
- **Client data arch**: the app does not use SWR/React Query — plain `fetch` with in-flight race guards. Don't add a data-fetching lib without asking.
- **Remote state transport**: analysis and AI-report progress use authenticated SSE (`startAnalysisStatus` / `subscribeAiReportEvents`); Redis/BullMQ events wake the stream, while `GET /api/job-status/:jobId` is only a hard-capped reconciliation fallback. Keep browser polling out of normal user-visible flows; use bounded one-shot reads for refresh/reconnect.
- **Voice/structure**: functional components, descriptive boolean names (`isLoading`, `hasError`), lowercase-with-dashes dirs, TS. Keep new shared components in the repo's existing `export default function` style.

## Server/API conventions

- Logging: winston via `lib/logger.ts` — never bare `console.*` in server src; keep the `type` event field; redaction is key-based in the logger format; access logs skip `/health` and log pathname only. Degradation fallbacks always log (no silent `.catch(() => …)`) — fail-open stays observable.
- Identity boundary: Elysia `onBeforeHandle` `as: "global"` in `src/lib/serviceGuard.ts`. Headers `x-service-token` + `x-verified-auth0-id`; missing/wrong/account mismatch → 403. Keep new org/email/auth/me routes under this guard.
- Browser-direct capability routes (`scan.ts`, `analyze.ts`, `chat.ts`, `download.ts`, `status.ts`) never trust a raw `x-auth0-id`. For attribution, the web mints a signed token via `/api/me/attribution/mint` (`src/lib/attribution.ts`, HMAC-SHA256 over `sub.exp`, SERVICE_TOKEN keyed) and sends it as `x-attribution`; the server `verifyAttributionToken()`s it. Add endpoints for minting only under serviceGuard.
- Row uniqueness for org tables is org-scoped: `attendance UNIQUE (auth0_id, student_id, session_date)` and `performance_metrics UNIQUE (auth0_id, student_id, metric_key, measured_at)`. Keep `ON CONFLICT (…)` targets in `lib/org/*` (e.g. `org/attendance.ts:66`, `org/performance.ts:83`) in sync with these constraint column lists (idempotent migration lives in `ensureInitialized` in `src/lib/historyStore.ts`, the sole DDL owner).
- Supabase helpers live in `src/lib/` (`orgData.ts` — a thin barrel over `lib/org/*`, one module per subdomain — and `historyStore.ts` for schema/DDL). Data-layer functions take optional filter opts (e.g., `getUserAnalyses(…, { unlinked })`) rather than adding query params at the route layer.
- Wrapper-owned init: `withHistoryStore`/`withHistoryStoreOrThrow` share `runWithHistoryStore`, which awaits `ensureInitialized()` before the callback — never `await ensureInitialized()` inside a callback; absorb the disabled/null sentinel with `orDisabledDefault(value, fallback)` (the one no-DB degradation policy).
- Self-scoped handlers derive identity with `requireVerifiedSelf`/`missingVerifiedSelf` (`lib/caller.ts`) — never hand-roll the `x-verified-auth0-id` check; share.ts/auth.ts keep their verified-but-different idiom.
- Analysis admission is one call: `admitAnalysis` (`lib/analysisAdmission.ts`) owns quota → tier → priority → usage; pass `basePriority` 5 (`/api/analyze`) or 10 (`/api/me/analyze`) — don't re-inline the gate or the tier-weight math.
- Queue is lazy: importing `lib/queue.ts` connects nothing; `index.ts` calls `startQueueInfrastructure()` first (`stopQueueInfrastructure()` on shutdown), late consumers attach via `onQueueInfrastructureReady(...)`; retry verdicts come from `classifyFailure()`; retention scheduling lives in `lib/retention.ts`.
- Chat stores implement the `Transcript` interface (`lib/transcript.ts`: `playerTranscript` Redis, `dashboardTranscript` Postgres — a seam, not a store merge); parse SSE with `lib/sse.ts` (`parseSseDataEvents`), never hand-split chunks.
- Engine owns code → HTTP status + `retryable` (`engine/core/errors.py` `STATUS_BY_CODE`/`RETRYABLE_BY_CODE`); routes derive status only via `enginePassthroughStatus`/`chatEngineStatus` and send bodies through `errorBody(...)` — never re-map codes to statuses; `JOB_NOT_FOUND` is `retryable: false` on every path.
- Rate limiting + ids:429s come from `rateLimited()` (`src/lib/ratelimit.ts`); validate ids against `UUID_RE` (`src/lib/uuid.ts`). Don't hand-roll either.
- Engine HTTP surface: routes live under `engine/api/` (mounted by the thin `engine/main.py`); session-token mint/validation and upload cleanup live in `engine/sessions.py`.
- Sport vocab SSOT is `engine/core/sport_config.py` (positions/aliases/pack versions) — served through the guard-exempt `GET /sports/{sport}/positions`.
- Email: `src/lib/mailer.ts`. `RESEND_API_KEY` unset → routes return 501 `EMAIL_NOT_CONFIGURED` by design; smoke asserts it.
- Env: documented in `server/.env.example` and `web-next/.env.example`; keep them in sync with `process.env` reads.

## Environment / secrets

- `SERVICE_TOKEN` shared secret set on both server and web for the identity boundary.
- `RESEND_API_KEY` needed for live invite/report/attendance email.
- Live Neon DB through `DATABASE_URL` (server) / proxy (web). Users auto-link to org members by email.
