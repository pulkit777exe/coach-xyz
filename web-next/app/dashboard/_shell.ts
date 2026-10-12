/**
 * Card 7 — route page shell (RSC-only; never import from client components).
 *
 * One data-loading preamble shared by every dashboard/player route: fresh
 * render (`noStore()`), session guard (`redirect('/auth/login')`), and the
 * route's gate, followed by a route-local fetcher map fanned out over a
 * single `Promise.all` of the per-request cached `lib/serverData` fns
 * (Next.js docs parallel-fetch pattern). Each route keeps its own fetcher
 * map next to its render (Remix-loader-style locality) — the shell owns no
 * route registry and re-exports no fetchers.
 *
 * Gates:
 * - `'org'` — coach dashboard routes. Resolves the org context (switcher
 *   cookie aware) and returns `{ session, auth0Id, role }` — scope every
 *   fetcher to `auth0Id`, never `session.user.sub`. Returns `role` so the
 *   role-differentiated home (`dashboard/page.tsx`) can branch to its
 *   personal view for org-role players.
 * - `'player'` — player hub. Resolves the profile role the same way the hub
 *   always has (`getUserProfile`, failures → `null`) and bounces profile
 *   coaches to `/dashboard`. Returns `{ session, role }`.
 * - `'public'` — unauthenticated routes (no session, no org context).
 *   Reserved for future public pages; the share/invite pages keep their
 *   bespoke flows and do not use it (see below).
 *
 * Error semantics mirror the pre-shell preambles exactly:
 * - Per-fetcher resilience stays per-fetcher: pass a `fallback` entry for a
 *   key and that key's rejection resolves to the fallback (the old
 *   `.catch(() => FALLBACK)`); keys without an entry reject, so a bare
 *   `Promise.all` route still throws into `error.tsx`.
 * - Whole-block resilience stays in the page: call `loadPage` with no
 *   `fallback` inside the page's own `try/catch` (dashboard home, settings).
 * - Critical single-fetch-then-`notFound()` routes pass the null-shaped
 *   fallback (report detail, chat) or gate first and `try/catch` the data
 *   call (student/analysis detail, audit) — identical branching either way.
 *
 * Call twice when a route must branch on the gate before fetching (dashboard
 * home returns the personal view for players without running org fetches) or
 * isolate a critical fetch behind its own `try/catch`. Gate resolution is
 * `React.cache`-deduped per request (`getSession`, `getOrgContext`), so the
 * second call only runs its fetchers.
 *
 * Deliberately NOT shelled: `dashboard/layout.tsx` + `player/layout.tsx`
 * (own session/role gates, untouched), `share/[token]` (public token flow,
 * no session/org), `invite` (client component), and every
 * `generateMetadata` (must stay redirect-free).
 */

import { unstable_noStore as noStore } from 'next/cache'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'
import { getOrgContext, getUserProfile, type OrgRole } from '@/lib/serverData'

export type PageGate = 'org' | 'player' | 'public'

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>

/** Resolved context for `gate: 'org'` — org id + org role, plus the session. */
export type OrgShellCtx = {
  session: Session
  /** Org id to scope every fetcher against. Never `session.user.sub`. */
  auth0Id: string
  role: OrgRole
}

/** Resolved context for `gate: 'player'` — profile role, plus the session. */
export type PlayerShellCtx = {
  session: Session
  /** Profile role (`null` when the lookup fails, exactly as before). */
  role: 'coach' | 'player' | null
}

/** Resolved context for `gate: 'public'` — no session, no org. */
export type PublicShellCtx = {
  session: null
}

export type GateCtx<G extends PageGate> = G extends 'org'
  ? OrgShellCtx
  : G extends 'player'
    ? PlayerShellCtx
    : PublicShellCtx

/**
 * Route data loader: gate the request, then run the route's fetcher map in
 * parallel. `fetchers` maps a local name to `(ctx) => Promise<…>` over the
 * cached `lib/serverData` fns; `fallback` optionally maps the same names to
 * per-fetcher `.catch(() => …)` values.
 */
export async function loadPage<
  G extends PageGate,
  F extends Record<string, (ctx: GateCtx<G>) => Promise<unknown>> = Record<
    string,
    (ctx: GateCtx<G>) => Promise<unknown>
  >,
>(
  gate: G,
  fetchers: F = {} as F,
  fallback?: { [K in keyof F]?: unknown },
): Promise<GateCtx<G> & { data: { [K in keyof F]: Awaited<ReturnType<F[K]>> } }> {
  let ctx: OrgShellCtx | PlayerShellCtx | PublicShellCtx

  if (gate === 'org') {
    noStore()
    const session = await getSession()
    if (!session) redirect('/auth/login')
    const { auth0Id, role } = await getOrgContext()
    ctx = { session, auth0Id, role }
  } else if (gate === 'player') {
    noStore()
    const session = await getSession()
    if (!session) redirect('/auth/login')

    let role: PlayerShellCtx['role'] = null
    try {
      const { user } = await getUserProfile(session.user.sub)
      role = user?.role ?? null
    } catch (error) {
      console.error('Failed to resolve player role:', error)
    }

    if (role === 'coach') redirect('/dashboard')
    ctx = { session, role }
  } else {
    noStore()
    ctx = { session: null }
  }

  const keys = Object.keys(fetchers)
  const values = await Promise.all(
    keys.map((key) => {
      const promise = (fetchers[key] as (ctx: unknown) => Promise<unknown>)(ctx)
      if (fallback && Object.prototype.hasOwnProperty.call(fallback, key)) {
        const fb = (fallback as Record<string, unknown>)[key]
        return promise.catch(() => fb)
      }
      return promise
    }),
  )
  const data: Record<string, unknown> = {}
  keys.forEach((key, i) => {
    data[key] = values[i]
  })

  return { ...ctx, data } as unknown as GateCtx<G> & {
    data: { [K in keyof F]: Awaited<ReturnType<F[K]>> }
  }
}
