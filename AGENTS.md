# AGENTS.md

Guidance for agents working in this repo. Read `ARCHITECTURE.md` for the data model and request flows; `setup.md` for local setup.

## Project

CoachXYZ — multi-sport AI video analyzer. Three deployable tiers plus shared config:

- `web-next/` — Next.js 16 (App Router) + React 19 + TS + Tailwind v4. Coach dashboard, marketing site, player hub.
- `server/` — Bun 1.x + Elysia. Auth sync, org data layer, BullMQ orchestration, Supabase persistence, email (Resend).
- `engine/` — Python (3.11+ locally, 3.12-slim in Docker) + FastAPI. Video analysis pipeline (Gemini + MediaPipe).
- `sports/` — per-sport scoring config JSON. `docs/` — feature docs.

`web-next/proxy.ts` is the Next 16 Auth0 middleware (passthrough, not a reverse
proxy). The identity proxy is `web-next/app/api/service/[[...path]]/route.ts`
(allowlisted `/api/org|auth|email|me/*` → server with service headers); video
downloads go through the `next.config.ts` `/api/download/:path*` rewrite.

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

Tooling hygiene (learned 2026-10-13): always run app commands from the app dir (`cd server && bun run type-check`, never bare `bunx tsc`/`npx <bin>` from root — root has no local binaries, so the runner fetches wrong packages). Verify file writes landed (do not trust heredoc output alone). `/tmp/opencode` is volatile across restarts — rebuild the engine test venv there when missing.

Test baselines (keep green): server unit suite `bun test` = 371 pass / 36 files (excludes 5 live-infra files — aiReports, notifications, orgMembers, clipsStore, chatMessages — whose 17 tests fail with timeouts when Neon/Upstash are unreachable; verified identical on a pristine pre-pass-6 checkout, so environmental, not regressions); web `vitest run` = 789 tests / 72 files; reachability 232 source files / 72 test files → 170 statically imported (73.3%), 3 loaded only by the generic render sweep, 59 touched by nothing (14.1% of lines). engine `pytest tests -q` = 288 tests / 28 files (verified live 2026-10-14 in a rebuilt venv with test deps; mediapipe absent, pose tests run against the available backend); `tsc --noEmit` clean both; `next build` clean; live smoke `server/scripts/smokeOrgHttp.ts` = 51 checks. (Verified green 2026-10-13.)

Per-request dedup: RSC pages import data fetchers from `lib/serverData.ts` (React.cache-wrapped) and the session via `lib/session.ts` (`getSession`, React.cache) — never call entity-facade/`lib/org` fetchers or `auth0.getSession()` directly from pages. Facades/`lib/org` stay for client components, middleware (`proxy.ts`), and route handlers. Heavy client visuals (recharts) load via `next/dynamic` with `ssr: false`.

## Skills

Consulted skill guidance (installed locally, not vendored in the repo):

- `vercel-react-best-practices` — 70 perf rules, priority 1→8 (waterfalls, bundle size, server perf, client fetching, re-render, rendering, JS perf, advanced). Consult `SKILL.md` for the priority table and per-rule files under `rules/` when writing/refactoring React code.
- `nextjs-react-typescript` — TS/Next conventions (RSC bias, mobile-first, Suspense, images).

## Frontend conventions (from the skills, reconciled with repo state)

- **Data fetching**: parallelize independent fetches with `Promise.all` (async-parallel). Use `await connection()` from `next/server` on authenticated dashboard pages serving fresh data; nothing to cache, fetches hit the live API. (`unstable_noStore()` is deprecated in Next 16 and kept out of new code.) Prefer server components; add `"use client"` only where Web APIs/interactivity are needed.
- **No barrel imports.** Import directly (`@/components/org/ScheduleClient`, not `@/components`). Statically analyzable paths only.
- **Primitives**: use `@/components/9ui/ui/*` (button, badge, card, dialog, input, select, tooltip, chart, etc.). Legacy `components/ui/*` is deleted — do not resurrect. shadcn-style 9ui where available.
- **Re-render hygiene**: no components defined inside components; no synchronous `setState` in effect bodies (defer via `requestAnimationFrame`, move to event handlers, or derive during render); use functional `setState` and lazy `useState(() => ...)` for expensive init; keep non-trivial derived data in `useMemo` (e.g., `byDay` map in ScheduleClient); use `Map`/`Set` for repeated lookups (not `find` in loops).
- **Conditional rendering**: prefer ternaries over `{x && ...}` when the left side could render a falsy number. Watch `.length`-based conditionals.
- **Styling**: Tailwind classes via the token system in `app/globals.css` (`bg-card`, `text-muted-foreground`, `border-border`). Marketing pages are always-dark using `--marketing-*` vars. Mobile-first.
- **Client data arch**: the app does not use SWR/React Query — plain `fetch` with in-flight race guards. Don't add a data-fetching lib without asking.
- **Voice/structure**: functional components, descriptive boolean names (`isLoading`, `hasError`), lowercase-with-dashes dirs, TS. Keep new shared components in the repo's existing `export default function` style.

## Server/API conventions

- Identity boundary: Elysia `onBeforeHandle` `as: "global"` in `src/lib/serviceGuard.ts`. Headers `x-service-token` + `x-verified-auth0-id`; missing/wrong/account mismatch → 403. Keep new org/email/auth/me routes under this guard.
- Browser-direct capability routes (`scan.ts`, `analyze.ts`, `chat.ts`, `download.ts`, `status.ts`) never trust a raw `x-auth0-id`. For attribution, the web mints a signed token via `/api/me/attribution/mint` (`src/lib/attribution.ts`, HMAC-SHA256 over `sub.exp`, SERVICE_TOKEN keyed) and sends it as `x-attribution`; the server `verifyAttributionToken()`s it. Add endpoints for minting only under serviceGuard.
- Row uniqueness for org tables is org-scoped: `attendance UNIQUE (auth0_id, student_id, session_date)` and `performance_metrics UNIQUE (auth0_id, student_id, metric_key, measured_at)`. Keep `ON CONFLICT (…)` targets in `orgData.ts` in sync with these constraint column lists (idempotent migration lives in `ensureInitialized` in `historyStore.ts`).
- Supabase helpers live in `src/lib/` (`orgData.ts`, `historyStore.ts`). Data-layer functions take optional filter opts (e.g., `getUserAnalyses(…, { unlinked })`) rather than adding query params at the route layer.
- Email: `src/lib/mailer.ts`. `RESEND_API_KEY` unset → routes return 501 `EMAIL_NOT_CONFIGURED` by design; smoke asserts it.
- Env: documented in `server/.env.example` and `web-next/.env.example`; keep them in sync with `process.env` reads.

## Environment / secrets

- `SERVICE_TOKEN` shared secret set on both server and web for the identity boundary.
- `RESEND_API_KEY` needed for live invite/report/attendance email.
- Live Neon DB through `DATABASE_URL` (server) / proxy (web). Users auto-link to org members by email.

`SettingsClient.tsx` (164)
