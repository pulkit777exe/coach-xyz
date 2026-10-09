import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { appFace, type AppFaceInput } from '../appFace'

// ── The face decision, its consumers, and why ONE rule exists ────────────────────
//
// `users.role` (account, written once at account creation — nothing writes
// `'coach'` back) and `org_members.role` (membership, live) answer different
// questions, and the topbar + BOTH routing gates used to read the account one
// alone. A head_coach whose account was born from a student link therefore had
// no org pill, no Dashboard link, and `/dashboard` bounced them to `/player`.
//
// Three layers of assertion, because each catches a different regression:
//   1. the RULE over fixtures, including the defect itself;
//   2. a loop-freedom PROPERTY (the dashboard gate may only ever answer
//      `'player'` for account-`player` viewers, which is exactly the condition
//      under which `app/player/page.tsx`'s own redirect does NOT fire);
//   3. SOURCE tripwires over the two call sites, each matcher proven against a
//      fixture that CONTAINS the pre-fix defect — an assertion over clean
//      sources cannot tell a working matcher from a broken one.

const ROOT = join(import.meta.dirname, '..', '..')
if (!existsGuardRoot()) throw new Error(`bad ROOT: ${ROOT}`)
function existsGuardRoot(): boolean {
  try {
    return readFileSync(join(ROOT, 'components', 'AuthHeader.tsx'), 'utf8').length > 0
  } catch {
    return false
  }
}

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const authHeader = read('components', 'AuthHeader.tsx')
const headerClient = read('components', 'HeaderClient.tsx')
const layout = read('app', 'dashboard', 'layout.tsx')
const playerPage = read('app', 'player', 'page.tsx')

const OWN = 'auth0|me'
const CLUB = 'auth0|club'
const row = (org_auth0_id: string, role: string) => ({ org_auth0_id, role })

// THE DEFECT, as a fixture: an account born from a student link (role `player`,
// immutable from here on) who is head_coach of the club.
const DEFECT: AppFaceInput = {
  accountRole: 'player',
  orgs: [row(CLUB, 'head_coach'), row(OWN, 'owner')],
  ownSub: OWN,
}

/** The pre-fix rule, verbatim in effect: the account field alone decides. */
const accountOnlyFace = (i: AppFaceInput): 'dashboard' | 'player' =>
  i.accountRole === 'player' ? 'player' : 'dashboard'

describe('appFace — which app face a viewer belongs on', () => {
  test('POSITIVE CONTROL: the fixture carries the defect the fix must remove', () => {
    // If this ever fails, the fixture no longer describes the bug and every
    // assertion below it is measuring something else.
    expect(accountOnlyFace(DEFECT)).toBe('player')
    // …and the real rule answers the other way — this is the defect being detected.
    expect(appFace(DEFECT)).toBe('dashboard')
  })

  test('a student-born account holding a staff membership lands on the dashboard', () => {
    expect(appFace(DEFECT)).toBe('dashboard')
    // Any non-player membership counts: analyst and medical are org staff too.
    for (const role of ['owner', 'admin', 'head_coach', 'assistant_coach', 'coach', 'analyst', 'medical']) {
      expect(
        appFace({ accountRole: 'player', orgs: [row(CLUB, role), row(OWN, 'owner')], ownSub: OWN }),
        `role: ${role}`,
      ).toBe('dashboard')
    }
  })

  test('a genuine player stays on the player face', () => {
    // Club membership exists, but its role is `player` — nothing promotes.
    expect(
      appFace({
        accountRole: 'player',
        orgs: [row(CLUB, 'player'), row(OWN, 'owner')],
        ownSub: OWN,
      }),
    ).toBe('player')
    // Membershipless player: the auto-seeded owner-of-self row must NOT read
    // as staff, or every linked student would be promoted into the coach app.
    expect(appFace({ accountRole: 'player', orgs: [row(OWN, 'owner')], ownSub: OWN })).toBe(
      'player',
    )
    expect(appFace({ accountRole: 'player', orgs: [], ownSub: OWN })).toBe('player')
  })

  test('membership never DEMOTES: an account-coach keeps the dashboard', () => {
    // The seeded player personas are exactly this crossing, and
    // app/dashboard/page.tsx renders them PlayerHome inside the dashboard by
    // design — so this direction is current product behaviour, not a guess.
    expect(
      appFace({
        accountRole: 'coach',
        orgs: [row(CLUB, 'player'), row(OWN, 'owner')],
        ownSub: OWN,
      }),
    ).toBe('dashboard')
    expect(appFace({ accountRole: 'coach', orgs: [], ownSub: OWN })).toBe('dashboard')
  })

  test('an unresolved read fails OPEN to the dashboard face', () => {
    // Failed profile (null) → full topbar, documented in AuthHeader.tsx.
    expect(appFace({ accountRole: null, orgs: [row(CLUB, 'head_coach')], ownSub: OWN })).toBe(
      'dashboard',
    )
    expect(appFace({ accountRole: undefined, orgs: [], ownSub: OWN })).toBe('dashboard')
    // Unresolved ownSub counts rows as staff rather than holding the player face.
    expect(appFace({ accountRole: 'player', orgs: [row(OWN, 'owner')], ownSub: null })).toBe(
      'dashboard',
    )
  })

  test('a FAILED org read preserves the old account-only answer', () => {
    // AuthHeader cannot distinguish failure from absence here, so the face
    // falls back to exactly what the pre-fix code did: account decides.
    expect(appFace({ accountRole: 'player', orgs: [], ownSub: OWN })).toBe('player')
    expect(appFace({ accountRole: 'coach', orgs: [], ownSub: OWN })).toBe('dashboard')
  })

  test('LOOP-FREEDOM PROPERTY: every player-face answer is an account-player', () => {
    // `app/player/page.tsx` redirects account-`coach` viewers to /dashboard.
    // If appFace could ever answer `player` for an account that is not
    // `player`, a viewer could be sent to /player and bounced straight back —
    // so the property below, plus that file's gate (pinned by source further
    // down), is the proof the two gates cannot both fire.
    const accountRoles = [null, undefined, 'coach', 'player'] as const
    const orgSets = [
      [],
      [row(OWN, 'owner')],
      [row(CLUB, 'player'), row(OWN, 'owner')],
      [row(CLUB, 'head_coach'), row(OWN, 'owner')],
      [row(CLUB, 'analyst')],
      [row(OWN, 'owner'), row(CLUB, 'admin')],
    ]
    const subs = [OWN, CLUB, null, undefined]
    for (const accountRole of accountRoles) {
      for (const orgs of orgSets) {
        for (const ownSub of subs) {
          const face = appFace({ accountRole, orgs, ownSub })
          if (face === 'player') expect(accountRole, JSON.stringify({ accountRole, orgs, ownSub })).toBe('player')
        }
      }
    }
  })
})

// ── Source tripwires: both gates must route through the shared rule ──────────────
//
// The behavioural half of this defect lives in two files no unit test can
// route a redirect through, so the wiring itself is pinned. Every matcher runs
// against a defective fixture FIRST — that is what proves it can fail.

/** Pre-fix chrome: the raw account role handed to HeaderClient. */
const accountOnlyChrome = (src: string): boolean => /role=\{role\}/.test(src)
/** Pre-fix routing: the account field deciding the /dashboard redirect alone. */
const accountOnlyGate = (src: string): boolean =>
  /if \(profileRole === 'player'\) redirect\('\/player'\)/.test(src)

const DEFECTIVE_AUTHHEADER = [
  '      role = profile?.user?.role ?? null',
  '  return <HeaderClient user={user} orgs={orgs} currentOrgId={currentOrgId} role={role} />',
].join('\n')

const DEFECTIVE_LAYOUT = [
  '  const profileRole = await profilePromise',
  "  if (profileRole === 'player') redirect('/player')",
].join('\n')

describe('both gates read the shared rule — source tripwires', () => {
  test('the CHROME matcher detects the pre-fix shape — positive control', () => {
    expect(accountOnlyChrome(DEFECTIVE_AUTHHEADER)).toBe(true)
    expect(accountOnlyChrome(authHeader)).toBe(false)
  })

  test('the ROUTING matcher detects the account-only redirect — positive control', () => {
    expect(accountOnlyGate(DEFECTIVE_LAYOUT)).toBe(true)
    expect(accountOnlyGate(layout)).toBe(false)
  })

  test('AuthHeader computes the face through appFace and passes it to HeaderClient', () => {
    // Exact call shape, not `appFace(` — a comment mentioning the call would
    // satisfy the looser pattern (a guard satisfied by its own documentation).
    expect(authHeader).toMatch(
      /appFace\(\{\s*accountRole,\s*orgs,\s*ownSub: session\.user\.sub\s*\}\) === 'player'/,
    )
    expect(authHeader).toMatch(/playerFace=\{playerFace\}/)
    // The profile read is an INPUT to the rule, never the prop itself.
    expect(headerClient).toMatch(/const isPlayer = playerFace/)
  })

  test('the dashboard gate resolves BOTH inputs and redirects on the shared rule', () => {
    expect(layout).toMatch(
      /appFace\(\{\s*accountRole: profileRole,\s*orgs: orgData\?\.myOrgs\.orgs \?\? \[\],\s*ownSub: session\.user\.sub,/,
    )
    expect(layout).toMatch(/redirect\('\/player'\)/)
    // The profile and org reads are awaited together — the rule needs both.
    expect(layout).toMatch(/await Promise\.all\(\[profilePromise, orgPromise\]\)/)
  })

  test('the player page keeps its account-field gate (the no-loop pairing)', () => {
    // Positive control on the matcher, then the real file: this gate fires
    // only for account-`coach` viewers, which appFace never answers `player`
    // for (the property above) — so the two redirects are disjoint.
    expect(accountCoachGate(`  if (role === 'coach') redirect('/dashboard')`)).toBe(true)
    expect(accountCoachGate('  // redirect removed')).toBe(false)
    expect(accountCoachGate(playerPage)).toBe(true)
  })
})

const accountCoachGate = (src: string): boolean =>
  /if \(role === 'coach'\) redirect\('\/dashboard'\)/.test(src)
