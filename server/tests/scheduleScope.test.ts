import { describe, expect, test } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Schedule + seasons team scope ─────────────────────────────────────────────
// ADR-0002 §5 left `schedule_events` and `seasons` org-wide because they carried
// no team key and hiding the fixture list from the coaches who need it is worse
// than the exposure. They now carry a team dimension instead of being hidden:
//
//   - an event with no team is a CLUB-LEVEL fixture and stays visible to every
//     caller (the rule `listMatches` already used for matches);
//   - an event with a team is visible only to that team's coaches;
//   - a season is org-level metadata, so it is hidden only when it holds at
//     least one match and none of them is visible to the caller.
//
// `attendance.write` stays a capability, not a scope: it says a role may run
// sessions, not whose calendar it may reshape, so every write also asks
// `canAccessTeam` (or, for a club-wide event, whether the caller is org-wide).
//
// The probe (scheduleScopeProbe.ts) runs in a fresh Bun process per case so its
// `mock.module` identity stubs cannot leak into the suite's module cache. It
// keeps the REAL `resolveCaller`, the REAL `permissions.ts` matrix, the REAL
// data layers and the REAL handlers, wired to a fixture store that applies the
// scope each query was handed and counts every write.

const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
const EVENT_A = '00000000-0000-0000-0000-0000000000c1'
const EVENT_B = '00000000-0000-0000-0000-0000000000c2'
const EVENT_CLUB = '00000000-0000-0000-0000-0000000000c3'
const SEASON_EMPTY = '00000000-0000-0000-0000-0000000000d1'
const SEASON_CLUB = '00000000-0000-0000-0000-0000000000d2'
const SEASON_A = '00000000-0000-0000-0000-0000000000d3'
const SEASON_B = '00000000-0000-0000-0000-0000000000d4'

type StoreLabels = {
  listSchedule: number
  getEvent: number
  listSeasons: number
  insertEvent: number
  updateEvent: number
  deleteEvent: number
}

type ProbeResult = {
  role: OrgMemberRole | null
  status: number
  body: unknown
  store: StoreLabels
  scopeLiteral: string | null
}

/** One route case, once per role, in a single isolated process. */
const runProbe = (
  probeCase: string,
  roles: readonly (OrgMemberRole | null)[],
  teams: readonly string[] = [],
): ProbeResult[] => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.SCHED_SCOPE_CASE = probeCase
  env.SCHED_SCOPE_ROLES = roles.map((role) => role ?? '__non_member__').join(',')
  env.SCHED_SCOPE_TEAMS = teams.length > 0 ? teams.join(',') : 'none'

  const proc = Bun.spawnSync({
    cmd: [process.execPath, 'tests/scheduleScopeProbe.ts'],
    cwd: new URL('..', import.meta.url).pathname,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `probe failed for ${probeCase}:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  const results = JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult[]
  expect(results.length).toBe(roles.length)
  return results
}

const forbidden = (message: string) => ({
  code: 'FORBIDDEN',
  message,
  layer: 'server',
  retryable: false,
})
const notFound = (message: string) => ({
  code: 'NOT_FOUND',
  message,
  layer: 'server',
  retryable: false,
})
const invalid = (message: string) => ({
  code: 'INVALID_REQUEST',
  message,
  layer: 'server',
  retryable: false,
})

const SCOPE_MESSAGE = 'Managing the schedule is limited to the teams in your scope'
const CAPABILITY_MESSAGE = 'Managing the schedule requires the attendance.write permission'
const FOREIGN_TEAM_MESSAGE = 'team not found in this organization'

const NO_WRITES: StoreLabels = {
  listSchedule: 0,
  getEvent: 0,
  listSeasons: 0,
  insertEvent: 0,
  updateEvent: 0,
  deleteEvent: 0,
}

const TEAM_STAFF: readonly OrgMemberRole[] = ['head_coach', 'assistant_coach', 'coach']
/** `assistant_coach` holds attendance.write, so every refusal below is scope. */
const SESSION_RUNNERS: readonly OrgMemberRole[] = ['head_coach', 'assistant_coach', 'coach']
/** Org staff: `analyst`/`medical` are org-wide by policy (ADR-0002 §1). */
const ORG_READERS: readonly OrgMemberRole[] = ['analyst', 'medical', 'owner', 'admin']

const events = (body: unknown): { id: string; team_id: string | null }[] =>
  (body as { events: { id: string; team_id: string | null }[] }).events
const seasons = (body: unknown): string[] =>
  (body as { seasons: { id: string }[] }).seasons.map((s) => s.id)

// ── A team-A coach sees team A plus the club calendar, never team B ──────────

describe('a team-A coach is narrowed to team A, club fixtures included', () => {
  test('the schedule list omits team B and keeps the team-less event', () => {
    const results = runProbe('read.list', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      const listed = events(result.body)
      expect(
        listed.map((e) => e.id),
        `role: ${result.role}`,
      ).toEqual([EVENT_A, EVENT_CLUB])
      expect(
        listed.map((e) => e.team_id),
        `role: ${result.role}`,
      ).not.toContain(TEAM_B)
      // The club fixture staying is the point of the rule: hiding it would be
      // over-narrowing and would take the club calendar off the coach's screen.
      expect(
        listed.map((e) => e.id),
        `role: ${result.role}`,
      ).toContain(EVENT_CLUB)
      expect(result.store.listSchedule, `role: ${result.role}`).toBe(1)
    }
  })

  test('the scope reaches Postgres as a uuid-array literal, scoped or NULL', () => {
    // A fixture store cannot check that the bind is legal in Postgres: Bun sends a
    // raw JS array as comma-joined text and `::uuid[]` then fails with 22P02 at
    // runtime. So pin the wire format — a literal for a scoped caller, SQL NULL
    // for an org-wide one.
    const [scoped] = runProbe('read.list', ['head_coach'], [TEAM_A])
    expect(scoped.scopeLiteral).toBe(`{${TEAM_A}}`)
    const [org] = runProbe('read.list', ['analyst'])
    expect(org.scopeLiteral).toBeNull()
  })

  test('an unassigned coach still sees the club calendar', () => {
    // The honest answer for "manages no team": club-level rows are not a team's
    // rows, so they stay; every team row goes.
    const results = runProbe('read.list', ['head_coach'], [])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect(
        events(result.body).map((e) => e.id),
        `role: ${result.role}`,
      ).toEqual([EVENT_CLUB])
    }
  })
})

// ── Seasons: narrowed by their matches, not hidden outright ─────────────────

describe('a season is hidden only when all of its matches belong elsewhere', () => {
  test('a team-A coach loses the team B season and keeps the other three', () => {
    const results = runProbe('read.seasons', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      const listed = seasons(result.body)
      expect(listed, `role: ${result.role}`).not.toContain(SEASON_B)
      // No matches yet, a club fixture, and a team A fixture all stay visible.
      expect(listed, `role: ${result.role}`).toContain(SEASON_EMPTY)
      expect(listed, `role: ${result.role}`).toContain(SEASON_CLUB)
      expect(listed, `role: ${result.role}`).toContain(SEASON_A)
      expect(result.store.listSeasons, `role: ${result.role}`).toBe(1)
    }
  })

  test('an unassigned coach keeps the empty and club seasons only', () => {
    // Including the empty one: hiding a season with no fixtures would take the
    // upcoming calendar off the coach's screen, which is the failure this change
    // exists to avoid.
    const results = runProbe('read.seasons', ['head_coach'], [])
    for (const result of results) {
      expect(seasons(result.body), `role: ${result.role}`).toEqual([SEASON_EMPTY, SEASON_CLUB])
    }
  })

  test('org staff see every season, not an empty list', () => {
    const results = runProbe('read.seasons', ORG_READERS)
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect(seasons(result.body).sort(), `role: ${result.role}`).toEqual(
        [SEASON_EMPTY, SEASON_CLUB, SEASON_A, SEASON_B].sort(),
      )
    }
  })
})

// ── Org staff are not narrowed ──────────────────────────────────────────────

describe('org staff and owners are not narrowed', () => {
  test('analyst and medical read the whole calendar org-wide', () => {
    for (const result of runProbe('read.list', ['analyst' as OrgMemberRole, 'medical'])) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect(
        events(result.body).map((e) => e.id),
        `role: ${result.role}`,
      ).toEqual([EVENT_A, EVENT_B, EVENT_CLUB])
      // No scope is bound at all, which is what "not narrowed" means on the wire.
      expect(result.scopeLiteral, `role: ${result.role}`).toBeNull()
    }
  })
})

// ── Writes: capability first, scope beside it, nothing attempted ─────────────

describe('a scoped coach may only write its own team', () => {
  test('creating a club-wide event is refused and nothing is written', () => {
    const results = runProbe('write.createClub', SESSION_RUNNERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(SCOPE_MESSAGE))
      expect(result.store.insertEvent, `role: ${result.role}`).toBe(0)
    }
  })

  test('creating an event for another team is refused and nothing is written', () => {
    const results = runProbe('write.createOtherTeam', SESSION_RUNNERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(SCOPE_MESSAGE))
      expect(result.store.insertEvent, `role: ${result.role}`).toBe(0)
    }
  })

  test("another team's event can be neither updated nor deleted", () => {
    for (const [probeCase, label] of [
      ['write.updateOtherTeam', 'updateEvent'],
      ['write.deleteOtherTeam', 'deleteEvent'],
    ] as const) {
      const results = runProbe(probeCase, SESSION_RUNNERS, [TEAM_A])
      for (const result of results) {
        expect(result.status, `${probeCase} role: ${result.role}`).toBe(403)
        expect(result.body, `${probeCase} role: ${result.role}`).toEqual(forbidden(SCOPE_MESSAGE))
        // The load is expected (that is how the refusal knows the team); the
        // write is not.
        expect(result.store.getEvent, `${probeCase} role: ${result.role}`).toBe(1)
        expect(result.store[label], `${probeCase} role: ${result.role}`).toBe(0)
      }
    }
  })

  test('the club-wide event is org staff alone, on update and delete too', () => {
    for (const [probeCase, label] of [
      ['write.updateClub', 'updateEvent'],
      ['write.deleteClub', 'deleteEvent'],
    ] as const) {
      const results = runProbe(probeCase, SESSION_RUNNERS, [TEAM_A])
      for (const result of results) {
        expect(result.status, `${probeCase} role: ${result.role}`).toBe(403)
        expect(result.body, `${probeCase} role: ${result.role}`).toEqual(forbidden(SCOPE_MESSAGE))
        expect(result.store[label], `${probeCase} role: ${result.role}`).toBe(0)
      }
    }
  })

  test('promoting an own-team event to the club calendar is refused', () => {
    const results = runProbe('write.updatePromote', SESSION_RUNNERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(SCOPE_MESSAGE))
      expect(result.store.updateEvent, `role: ${result.role}`).toBe(0)
    }
  })

  test('a team outside the org is 400, before the scope answer', () => {
    const results = runProbe('write.createForeignTeam', SESSION_RUNNERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(400)
      expect(result.body, `role: ${result.role}`).toEqual(invalid(FOREIGN_TEAM_MESSAGE))
      expect(result.store.insertEvent, `role: ${result.role}`).toBe(0)
    }
  })

  test('a missing event is 404 and not a 403', () => {
    // Ordering proof: "does not exist" is decided before "not yours", so a
    // scoped caller cannot use the status code to probe for ids.
    const results = runProbe('write.deleteMissing', SESSION_RUNNERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(404)
      expect(result.body, `role: ${result.role}`).toEqual(notFound('Schedule event not found'))
      expect(result.store.deleteEvent, `role: ${result.role}`).toBe(0)
    }
  })

  test('creating an event for its own team still works', () => {
    const results = runProbe('write.createOwnTeam', SESSION_RUNNERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(201)
      expect(result.store.insertEvent, `role: ${result.role}`).toBe(1)
      // The team is stored with the event: the dimension the read filters on.
      const created = (result.body as { event: { team_id: string | null } }).event
      expect(created.team_id, `role: ${result.role}`).toBe(TEAM_A)
    }
  })

  test('updating and deleting its own team event still work', () => {
    for (const [probeCase, label, status] of [
      ['write.updateOwnTeam', 'updateEvent', 200],
      ['write.deleteOwnTeam', 'deleteEvent', 200],
    ] as const) {
      const results = runProbe(probeCase, SESSION_RUNNERS, [TEAM_A])
      for (const result of results) {
        expect(result.status, `${probeCase} role: ${result.role}`).toBe(status)
        expect(result.store[label], `${probeCase} role: ${result.role}`).toBe(1)
      }
    }
  })

  test('an unassigned coach can write nothing at all', () => {
    for (const [probeCase, label] of [
      ['write.createOwnTeam', 'insertEvent'],
      ['write.createClub', 'insertEvent'],
      ['write.updateOwnTeam', 'updateEvent'],
      ['write.deleteOwnTeam', 'deleteEvent'],
    ] as const) {
      const [result] = runProbe(probeCase, ['head_coach'], [])
      expect(result.status, `${probeCase}`).toBe(403)
      expect(result.body, `${probeCase}`).toEqual(forbidden(SCOPE_MESSAGE))
      expect(result.store[label], `${probeCase}`).toBe(0)
    }
  })
})

describe('the club-wide calendar is org staff alone', () => {
  test('org staff may create a club-level event, and it stays team-less', () => {
    // `analyst`/`medical` hold no attendance.write, so the capability gate
    // answers first for them (checked below); the org-wide writers are the roles
    // that both hold the capability and are not narrowed.
    const results = runProbe('write.createClub', ['owner' as OrgMemberRole, 'admin'], [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(201)
      expect(result.store.insertEvent, `role: ${result.role}`).toBe(1)
      const created = (result.body as { event: { team_id: string | null } }).event
      expect(created.team_id, `role: ${result.role}`).toBeNull()
    }
  })

  test('org staff may edit and delete a club-level event', () => {
    for (const [probeCase, label] of [
      ['write.updateClub', 'updateEvent'],
      ['write.deleteClub', 'deleteEvent'],
    ] as const) {
      const results = runProbe(probeCase, ['owner' as OrgMemberRole, 'admin'], [TEAM_A])
      for (const result of results) {
        expect(result.status, `${probeCase} role: ${result.role}`).toBe(200)
        expect(result.store[label], `${probeCase} role: ${result.role}`).toBe(1)
      }
    }
  })
})

// ── The capability gate still answers first ─────────────────────────────────

describe('a missing capability is still 403, before the scope check', () => {
  test('a role without attendance.write never reaches the store', () => {
    // `analyst` and `medical` are org-wide by policy, so their 403 is provably
    // the capability and not the team scope.
    for (const probeCase of [
      'write.createClub',
      'write.createOwnTeam',
      'write.updateOwnTeam',
      'write.deleteOwnTeam',
    ]) {
      for (const result of runProbe(probeCase, ['analyst' as OrgMemberRole, 'medical'], [TEAM_A])) {
        expect(result.status, `${probeCase} role: ${result.role}`).toBe(403)
        expect(result.body, `${probeCase} role: ${result.role}`).toEqual(
          forbidden(CAPABILITY_MESSAGE),
        )
        expect(result.store, `${probeCase} role: ${result.role}`).toEqual(NO_WRITES)
      }
    }
  })

  test('a non-member is refused on the capability too', () => {
    for (const probeCase of ['write.createClub', 'write.deleteOwnTeam']) {
      const [result] = runProbe(probeCase, [null], [TEAM_A])
      expect(result.status, probeCase).toBe(403)
      expect(result.body, probeCase).toEqual(forbidden(CAPABILITY_MESSAGE))
      expect(result.store, probeCase).toEqual(NO_WRITES)
    }
  })

  test('reads are open to any member: scope narrows, it does not gate', () => {
    // A non-member resolves to an empty team list, which is a narrower read —
    // not a refusal. The org route floor is membership, not a capability.
    const [result] = runProbe('read.list', [null], [])
    expect(result.status).toBe(200)
    expect(events(result.body).map((e) => e.id)).toEqual([EVENT_CLUB])
  })
})
