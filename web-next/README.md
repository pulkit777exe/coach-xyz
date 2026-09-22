# web-next — Coach-XYZ Frontend

Next.js 16 (App Router) + React 19 + TypeScript frontend for Coach-XYZ, a multi-sport AI video analyzer.

## Scripts

```bash
bun install       # install dependencies
bun run dev       # start dev server on :3000
bun run build     # production build
bun run start     # serve production build
```

## Environment

Copy `.env.example` → `.env.local` and set:

- `NEXT_PUBLIC_API_URL` — base URL of the Elysia server (default `http://localhost:8000`)
- `NEXT_PUBLIC_SENTRY_DSN` — Sentry DSN (optional)
- Auth0: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (64-hex), `APP_BASE_URL`

Auth0 is required for `/dashboard`, `/account`, and authenticated uploads. Auth is handled by
`@auth0/nextjs-auth0` through `lib/auth0.ts` and `proxy.ts`.

## Structure

```
app/
  page.tsx                     Home — pipeline SPA (idle → … → chatting/error)
  dashboard/                   Authenticated area (overview, history, analysis detail, chat)
  account/                     Auth0 profile + DB record
lib/
  api.ts                       API client (all fetch + SSE helpers)
  usePipeline.ts               Upload→analyze→chat pipeline state machine
  auth0.ts                     Auth0Client singleton
  sports.ts / utils.ts         Helpers
components/                    UI: LandingPage, PlayerSelector, AnalysisProgress,
                               ResultsSummary, ErrorScreen, ChatLayout, ChatPanel,
                               VideoPlayer, DashboardNav, ui/ primitives, …
types/index.ts                 Shared API types
```

The pipeline polls `GET /api/job-status/:jobId`, streams scan/chat progress over SSE, and proxies
video downloads through `next.config.ts` `/api/download/:path*` rewrite.

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the full architecture and [../setup.md](../setup.md) for setup.

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the full architecture and [../setup.md](../setup.md) for setup.
