// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactElement } from 'react'

// ── A failed org read that FABRICATED an "owner" workspace ─────────────────────
//
// `AuthHeader` sits in `app/layout.tsx:60`, so it decides the topbar on every page in
// the app. It reads three things in one `Promise.all` — the org context, the caller's
// orgs, and their profile — and only the PROFILE fetch had a `.catch`. So a transient
// 5xx or timeout from `GET /api/me/orgs` rejected the whole `Promise.all`, landing in the
// outer catch with `orgs` still `[]`.
//
// The fallback then ran on `!orgs.length` — a condition that cannot distinguish "you have
// no orgs" from "we could not read yours" — and fabricated one: the caller's own sub,
// `role: 'owner'`, labelled with their own name.
//
// What a coach saw: an invited head coach hitting a database blip got a workspace pill
// reading their own name marked "owner", in the single-org face with no switcher. And
// because every dashboard page independently falls back to owner-of-self, the entire app
// rendered as an empty personal workspace. No error was visible anywhere: the
// `console.error` is server-side.
//
// WHY IT IS TESTED WITHOUT A RENDERER. `AuthHeader` is `async`, so `renderToStaticMarkup`
// throws "A component suspended while responding to synchronous input" — which is also
// why the a11y sweep registers it as a `skip:`, and why its recorded reason ("renders
// directly") contradicted its own skip. Calling it directly returns a `<HeaderClient>`
// element whose PROPS are the whole decision, so no DOM, no provider and no renderer are
// needed. Asserting on props rather than markup is also what makes the distinction
// legible: the bug is that two different server states produced identical props.

let noise: unknown[]

beforeEach(() => {
  noise = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => noise.push(a[0]))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

const session = { user: { sub: 'auth0|coach', name: 'Ada Lovelace' } }

const load = async (opts: {
  orgs: Array<{ org_auth0_id: string; role: string; display_name: string }>
  orgsThrows?: boolean
  ctxThrows?: boolean
  /** `users.role` for the profile fetch — `'coach'` unless a case says otherwise. */
  accountRole?: string | null
}) => {
  vi.doMock('@/lib/session', () => ({ getSession: async () => session }))
  vi.doMock('@/lib/serverData', () => ({
    getOrgContext: async () => {
      if (opts.ctxThrows) throw new Error('org context 500')
      return { auth0Id: 'auth0|club', role: 'head_coach' }
    },
    getMyOrgsCached: async () => {
      if (opts.orgsThrows) throw new Error('orgs 500')
      return { orgs: opts.orgs }
    },
    getUserProfile: async () =>
      opts.accountRole === null ? null : { user: { role: opts.accountRole ?? 'coach' } },
  }))
  // Mocked only so the module graph stays small; the element AuthHeader RETURNS carries
  // the props, and calling an async component returns that element without rendering it.
  // So the mock is never invoked — which is fine, and is why the props are read from the
  // return value rather than from the mock.
  vi.doMock('@/components/HeaderClient', () => ({ default: () => null }))
  const mod = await import('@/components/AuthHeader')
  return mod.default as () => Promise<ReactElement>
}

/** Call the async component and return the props it handed `HeaderClient`. */
const render = async (AuthHeader: () => Promise<ReactElement>) => {
  const el = await AuthHeader()
  if (!el || typeof el !== 'object' || !('props' in el))
    throw new Error(`expected a <HeaderClient> element, got ${String(el)}`)
  return el.props as {
    orgs: unknown[]
    currentOrgId: string | null
    playerFace: boolean
  }
}

describe('AuthHeader — a failed org read must not fabricate an org', () => {
  test('a real single-org owner still gets their org', async () => {
    // The happy path, and it must not regress.
    const AuthHeader = await load({
      orgs: [{ org_auth0_id: 'auth0|club', role: 'owner', display_name: 'Club' }],
    })
    const { orgs, currentOrgId } = await render(AuthHeader)
    expect(orgs).toHaveLength(1)
    expect(orgs[0]).toMatchObject({ org_auth0_id: 'auth0|club', role: 'owner' })
    expect(currentOrgId).toBe('auth0|club')
  })

  test('a genuine no-orgs account DOES get the owner-of-self fallback', async () => {
    // The other half of the pair. Without this, the fix would be indistinguishable from
    // deleting the fallback — and a single-coach account with no org would render an
    // empty topbar with no explanation.
    const AuthHeader = await load({ orgs: [] })
    const { orgs, currentOrgId } = await render(AuthHeader)
    expect(orgs).toHaveLength(1)
    expect(orgs[0]).toMatchObject({ org_auth0_id: 'auth0|coach', role: 'owner' })
    expect(currentOrgId).toBe('auth0|coach')
  })

  test('a FAILED orgs read fabricates nothing', async () => {
    // THE case. `orgs` empty plus `currentOrgId` null is the honest rendering of "we
    // could not read your orgs" — and the caller is expected to degrade rather than
    // invent a workspace.
    const AuthHeader = await load({ orgs: [], orgsThrows: true })
    const { orgs, currentOrgId } = await render(AuthHeader)
    expect(orgs).toEqual([])
    expect(currentOrgId).toBeNull()
  })

  test('a FAILED org-context read fabricates nothing', async () => {
    // The same `Promise.all`, so the same outcome — and it shares the cached
    // `getMyOrgs` promise, so one upstream failure takes both.
    const AuthHeader = await load({
      orgs: [{ org_auth0_id: 'auth0|club', role: 'owner', display_name: 'Club' }],
      ctxThrows: true,
    })
    const { orgs, currentOrgId } = await render(AuthHeader)
    expect(orgs).toEqual([])
    expect(currentOrgId).toBeNull()
  })

  test('failure and absence are now DISTINGUISHABLE — the point of the fix', async () => {
    // Asserted as a comparison rather than as two absolute cases, because the bug was
    // precisely that these two states produced identical props.
    // Two SEPARATE modules, each with its own mock registration. Loading twice inside one
    // test does not work: the second `vi.doMock` for the same specifier is shadowed by the
    // first module instance already in the registry, so the "absent" case silently
    // inherited the "throws" mocks and reported [] as well. The assertion then failed with
    // "expected [] to not deeply equal []" — which reads like a broken fix and is actually
    // a reused fixture.
    //
    // `vi.resetModules()` alone is not enough either; it is in `afterEach`. Asserting on
    // the comparison is what exposed it, which is the argument for keeping this case
    // rather than the two absolute ones alone.
    const failed = await render(await load({ orgs: [], orgsThrows: true }))
    vi.resetModules()
    const absent = await render(await load({ orgs: [] }))
    expect(failed.orgs).not.toEqual(absent.orgs)
    expect(absent.orgs).toHaveLength(1)
    expect(failed.orgs).toHaveLength(0)
  })

  test('playerFace stays false on failure, so a player is not mislabelled', async () => {
    // A null `accountRole` resolves to the DASHBOARD face, i.e. `playerFace` false —
    // the documented fail-open intent: gating never locks out unresolved context.
    // Fabricating a role to look tidy would be the same lie one level up: a transient
    // blip must not turn a coach's account into somebody else's role.
    const AuthHeader = await load({ orgs: [], orgsThrows: true })
    const { playerFace } = await render(AuthHeader)
    expect(playerFace).toBe(false)
  })

  test('the failure is still logged — fail-open stays observable', async () => {
    const AuthHeader = await load({ orgs: [], orgsThrows: true })
    await AuthHeader()
    // Rendering nothing instead of fabricating something must not be SILENT: AGENTS.md
    // requires a degradation fallback to stay observable, and the previous behaviour was
    // observable only on the server.
    expect(noise.some((n) => String(n).includes('Failed to resolve org switcher'))).toBe(true)
  })

  test('an unauthenticated visitor gets no orgs and no fabrication', async () => {
    vi.doMock('@/lib/session', () => ({ getSession: async () => null }))
    vi.doMock('@/lib/serverData', () => ({
      getOrgContext: async () => ({ auth0Id: null, role: null }),
      getMyOrgsCached: async () => ({ orgs: [] }),
      getUserProfile: async () => null,
    }))
    vi.doMock('@/components/HeaderClient', () => ({ default: () => null }))
    const mod = await import('@/components/AuthHeader')
    const { orgs, currentOrgId, playerFace } = await render(
      mod.default as () => Promise<ReactElement>,
    )
    expect(orgs).toEqual([])
    expect(currentOrgId).toBeNull()
    expect(playerFace).toBe(false)
  })
})

// ── `users.role` vs membership role: which vocabulary decides the app face ───────
//
// AGENTS.md records (from `docs/audits/2026-10-08-frontend.md`): `AuthHeader.tsx:41`
// threw away `resolveOrgContext`'s membership `role` and took the ACCOUNT column
// (`users.role`), which is written once at account creation (`server/src/lib/users.ts:40`
// `linkPlayerToStudent`, called only from `upsertUser:158`) and never updated. So a
// head_coach whose account row says `player` — a real account born from a student link
// — lost the org pill and the Dashboard link entirely.
//
// The fix is `lib/appFace`: the account field can keep someone on the player face, but
// a live non-`player` membership in an org that is not their own sub promotes to the
// dashboard face; the owner-of-self row (whose `org_auth0_id` equals the caller's sub)
// is excluded because every account gets one. Both cases below are the DEFECT and its
// CONTROL; the shared rule itself is pinned in `lib/__tests__/appFace.test.ts`.
describe('AuthHeader — the account column must not demote a live staff membership', () => {
  test('DEFECT: head_coach with users.role=player still gets the dashboard face', async () => {
    // The recorded case. Before the fix this prop was `role: 'player'` (the account
    // column), so the pill and the Dashboard link vanished for a working head coach.
    const AuthHeader = await load({
      orgs: [{ org_auth0_id: 'auth0|club', role: 'head_coach', display_name: 'Club' }],
      accountRole: 'player',
    })
    const { playerFace } = await render(AuthHeader)
    expect(playerFace).toBe(false)
  })

  test('control: a genuine player in a club stays on the player face', async () => {
    // The other direction, without which the fix would just delete the player face.
    // `player` membership in a club that is NOT the caller's own sub is a real player.
    const AuthHeader = await load({
      orgs: [{ org_auth0_id: 'auth0|club', role: 'player', display_name: 'Club' }],
      accountRole: 'player',
    })
    const { playerFace } = await render(AuthHeader)
    expect(playerFace).toBe(true)
  })

  test('control: owner-of-self alone never promotes a player account', async () => {
    // Every account is seeded with an owner-of-self row; if it counted as a staff
    // membership, every player would land on the dashboard. `session.user.sub` is
    // `auth0|coach` (the fixture above), so this row is the caller's own workspace.
    const AuthHeader = await load({
      orgs: [{ org_auth0_id: 'auth0|coach', role: 'owner', display_name: 'Ada Lovelace' }],
      accountRole: 'player',
    })
    const { playerFace } = await render(AuthHeader)
    expect(playerFace).toBe(true)
  })
})
