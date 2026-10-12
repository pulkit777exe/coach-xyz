# web-next — CoachXYZ Frontend

Next.js 16 (App Router) + React 19 + TypeScript frontend for CoachXYZ, a multi-sport AI video analyzer.

## Scripts

```bash
npm install       # install dependencies (web uses npm, not bun)
npm run dev       # start dev server on :3000
npm run build     # production build
npm run start     # serve production build
npm run lint      # eslint
npm test          # vitest run (180 tests / 18 files)
```

## Environment

Copy `.env.example` → `.env.local` and set:

- `NEXT_PUBLIC_API_URL` — base URL of the Elysia server (default `http://localhost:8000`)
- `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` — Sentry (optional; auth token is build-time only)
- `SERVICE_TOKEN` — must match the server's value; authenticates the identity proxy below
- Auth0: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (64-hex), `APP_BASE_URL`

Auth0 is required for `/dashboard/*`, `/player`, `/account`, and attributed uploads.
Auth is handled by `@auth0/nextjs-auth0` through `lib/auth0.ts`; `proxy.ts` is the
Next 16 middleware (Auth0 passthrough, not a reverse proxy).

## Structure

```
app/
  page.tsx                     Home — pipeline SPA (idle → … → chatting/error)
  dashboard/                   Coach area: overview, students, teams, members,
                               audit, attendance, schedule, reports (+[id]),
                               history, analysis/[id] (+/chat), settings
  player/                      Player hub shell + role gate → PlayerHub
  invite/                      Token-invite accept flow (AcceptInviteClient)
  share/[token]/               Public shared-analysis view
  account/                     Auth0 profile + DB record
  api/service/[[...path]]/     Identity proxy → server (allowlist only)
lib/
  api.ts                       API client: capability routes (direct) + identity
                               routes (via /api/service); attribution tokens
  usePipeline.ts               Upload→analyze→chat pipeline state machine
  useScanFlow.ts               Scan/upload state machine (coach + player hub)
  serverData.ts                React.cache RSC fetchers (pages import these)
  session.ts                   React.cache getSession (RSC only)
  org.ts / teams.ts / members.ts / meApi.ts / aiReports.ts
                               Org, teams, members, player-hub, AI-report clients
  serviceProxy.ts              Proxy allowlist (identity vs static-vocab paths)
  sports.ts / analysis.ts / csv.ts / date.ts / errors.ts / sse.ts / jobPolling.ts
                               Pure helpers (unit-tested)
components/
  AppClient / AnalysisDetailClient / ResultsSummary / AnalysisProgress /
  PlayerSelector / VideoPlayer / FindingsTimeline / ClipsSection / ChatLayout /
  ChatPanel / HistoryChat / QuickActions / ErrorScreen / LandingPage / …
  org/                         Coach dashboard clients (roster, attendance grid,
                               schedule, reports, objectives kanban, …)
  player/PlayerHub.tsx         Read-only player self view
  notifications/               Notification bell (SSE)
  interior/                    Generic UI primitives (modal, drawer, …)
  marketing/                   Marketing-site islands (contact form, …)
  9ui/ui/                      shadcn-style primitives (button, badge, card, …)
```

RSC pages fetch via `lib/serverData.ts` (React.cache) with `unstable_noStore()`
on authenticated pages; client components fetch via `lib/api.ts` / `lib/org.ts`.
Capability routes (upload/scan/analyze/status/download/chat SSE) go browser→server
directly with a signed `x-attribution` token minted at `/api/me/attribution/mint`;
everything user-scoped transits the `/api/service` proxy with service headers.
Video downloads go through the `next.config.ts` `/api/download/:path*` rewrite.
Heavy visuals (recharts `PerformanceChart`) load via `next/dynamic` (`ssr: false`).

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the full architecture and [../setup.md](../setup.md) for setup.
