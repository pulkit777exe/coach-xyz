import { unstable_noStore as noStore } from 'next/cache'
import { redirect } from 'next/navigation'

import { getSession } from '@/lib/session'
import { getOrgContext, getUserProfile, type OrgRole } from '@/lib/serverData'

export type PageGate = 'org' | 'player' | 'public'

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>

export type OrgShellCtx = {
  session: Session
  auth0Id: string
  role: OrgRole
}

export type PlayerShellCtx = {
  session: Session
  role: 'coach' | 'player' | null
}

export type PublicShellCtx = {
  session: null
}

export type GateCtx<G extends PageGate> = G extends 'org'
  ? OrgShellCtx
  : G extends 'player'
    ? PlayerShellCtx
    : PublicShellCtx

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
