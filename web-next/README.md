# web-next — Coach-XYZ Frontend

Next.js 16 (App Router) + React 19 + TypeScript frontend for Coach-XYZ, a multi-sport AI video analyzer.

## Scripts

```bash
npm install       # install dependencies (CI uses `npm ci`; see the lockfile note below)
npm run dev       # start dev server on :3000
npm run build     # production build
npm run start     # serve production build
```

> **Lockfile.** This package currently has both `package-lock.json` and
> `bun.lock`, and CI installs with `npm ci` — so `package-lock.json` is the one
> CI trusts. Use npm here unless you are deliberately changing the lockfile; a
> `bun install` can resolve a different tree and the divergence is invisible
> until CI disagrees.

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
  (marketing/)                 about, features, pricing, blog, contact …
  dashboard/                   Authenticated area (overview, history, analysis detail, chat)
  player/                      Player hub (role-gated away from /dashboard)
  account/                     Auth0 profile + DB record
  api/                         Route handlers; /api/* is proxied to the server
lib/
  api.ts                       API client (all fetch + SSE helpers)
  serverData.ts                React.cache-wrapped fetchers for RSC pages
  permissions.ts               role→permission mirror of the server matrix (UX only)
  nav.ts                       Nav role floors + visibleNavGroups
  usePipeline.ts               Upload→analyze→chat pipeline state machine
  auth0.ts                     Auth0Client singleton
  sports.ts / utils.ts         Helpers
components/
  9ui/ui/                      Structural primitives (avatar, button, card, dialog, …)
  interior/                    Vendored micro-interaction components
  marketing/ dashboard/ org/ player/ notifications/
types/index.ts                 Shared API types
```

Import primitives from `@/components/9ui/ui/*`; there are no barrel imports.

The pipeline subscribes to `GET /api/job-events/:jobId` for live analysis state (with a
strictly bounded status reconciliation only when the stream is unavailable), streams
scan/chat/report/notification progress over SSE, and proxies video downloads through
`next.config.ts` `/api/download/:path*` rewrite.

`lib/permissions.ts` mirrors the server matrix purely to hide affordances the server
would reject — the server is the enforcement point. See
[../docs/CODEBASE_MAP.md](../docs/CODEBASE_MAP.md) for the full module map and
[../setup.md](../setup.md) for setup.
