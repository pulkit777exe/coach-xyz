import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Org read-scope guards ────────────────────────────────────────────────────
// Four org surfaces used to answer org-wide no matter who asked: the rollup
// (`/overview`) and the search box (`/search`) took no scope argument at all, the
// wellness routes resolved to a student id without asking whose player it is,
// and `getStudent` was the by-id door into the roster even though `listStudents`
// was already narrowed. Each now takes the caller's visible-student set
// (`lib/org/scope.ts`) — `null` org-wide, a list those students, `[]` none.
//
// The probe (orgReadScopeProbe.ts) runs in a fresh Bun process per case so its
// `mock.module` identity stubs cannot leak into the suite's module cache. It
// keeps the REAL `resolveCaller`, the REAL `permissions.ts` matrix, the REAL
// `scope.ts` seam, the REAL data layer and the REAL handlers, and wires the real
// historyStore to a fixture connection that answers each query by applying the
// scope it was handed — so these tests fail if the scope stops reaching SQL, not
// only if a route forgets to pass it.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'orgReadScopeProbe.ts')

const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const S_A1 = '00000000-0000-0000-0000-0000000000a2'
const S_B1 = '00000000-0000-0000-0000-0000000000b2'

type StoreLabels = {
  scopeIds: number
  overview: number
  searchStudents: number
  searchSchedule: number
  searchReports: number
  searchAnalyses: number
  getStudent: number
  wellnessSelect: number
  wellnessInsert: number
}

type ProbeResult = {
  role: OrgMemberRole | null
  status: number
  body: unknown
  student: string | null
  store: StoreLabels
  scopeLiteral: string | null
}

/** One route (or data-layer) case, once per role, in a single isolated process. */
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
  env.ORG_READ_SCOPE_CASE = probeCase
  env.ORG_READ_SCOPE_ROLES = roles.map((role) => role ?? '__non_member__').join(',')
  env.ORG_READ_SCOPE_TEAMS = teams.length > 0 ? teams.join(',') : 'none'

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
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

const SCOPE_MESSAGE = 'Wellness data is limited to the students in your team scope'
const MEDICAL_MESSAGE = 'Reading wellness data requires the medical permission'
const MANAGE_MESSAGE = 'Recording wellness data requires player.manage'

// ── Expected rollups ─────────────────────────────────────────────────────────
// Fixtures: team A holds Player A1 (active) + Player A2 (transferred) and is
// 2-for-2 on attendance; team B holds Player B1, absent. The org-wide row is
// 3 players, 2 active, 2 linked analyses, 66.7% attendance. The two schedule
// numbers are org-wide by design (`schedule_events` has no student or team key),
// so they are the same in every row.
const TEAM_A_OVERVIEW = {
  student_count: 2,
  active_students: 1,
  sessions_this_month: 2,
  upcoming_events: 1,
  analyses_linked: 1,
  avg_attendance_rate: 100,
}
const ORG_OVERVIEW = {
  student_count: 3,
  active_students: 2,
  sessions_this_month: 2,
  upcoming_events: 1,
  analyses_linked: 2,
  avg_attendance_rate: 66.7,
}
const NOTHING_OVERVIEW = {
  student_count: 0,
  active_students: 0,
  sessions_this_month: 0,
  upcoming_events: 0,
  analyses_linked: 0,
  avg_attendance_rate: null,
}

const NO_STORE_QUERIES: StoreLabels = {
  scopeIds: 0,
  overview: 0,
  searchStudents: 0,
  searchSchedule: 0,
  searchReports: 0,
  searchAnalyses: 0,
  getStudent: 0,
  wellnessSelect: 0,
  wellnessInsert: 0,
}

const TEAM_STAFF: readonly OrgMemberRole[] = ['head_coach', 'assistant_coach', 'coach']
/** `assistant_coach` cannot manage the roster, so it is not a wellness writer. */
const TEAM_MANAGERS: readonly OrgMemberRole[] = ['head_coach', 'coach']
/** Org staff: `analyst`/`medical` are org-wide by policy, owners/admins bypass. */
const ORG_WIDE: readonly OrgMemberRole[] = ['analyst', 'medical', 'owner', 'admin']

const labels = (body: unknown, key: string): string[] => {
  const items = (body as Record<string, Array<{ label: string }>>)[key]
  return (items ?? []).map((item) => item.label)
}

// ── A team-A coach sees team A and nothing else ──────────────────────────────

describe('a team-A coach is narrowed to team A', () => {
  test('GET /overview counts only team A', () => {
    const results = runProbe('overview.get', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect((result.body as { overview: unknown }).overview, `role: ${result.role}`).toEqual(
        TEAM_A_OVERVIEW,
      )
      // The route asked the seam once, then read the rollup once.
      expect(result.store.scopeIds, `role: ${result.role}`).toBe(1)
      expect(result.store.overview, `role: ${result.role}`).toBe(1)
    }
  })

  test('the scope reaches Postgres as a uuid-array literal, scoped or NULL', () => {
    // The one thing a fixture store cannot check is whether the bind is legal in
    // Postgres: Bun sends a raw JS array as comma-joined text and `::uuid[]`
    // then fails with 22P02 at runtime. So pin the wire format — a literal for a
    // scoped caller, SQL NULL for an org-wide one.
    const [scoped] = runProbe('overview.get', ['head_coach'], [TEAM_A])
    expect(scoped.scopeLiteral).toBe(`{${TEAM_A}}`)
    const [org] = runProbe('overview.get', ['analyst'])
    expect(org.scopeLiteral).toBeNull()
  })

  test('GET /overview counts are not the org rollup', () => {
    const [scoped] = runProbe('overview.get', ['head_coach'], [TEAM_A])
    const [org] = runProbe('overview.get', ['analyst'])
    expect(scoped.body).not.toEqual(org.body)
    expect(org.body).toEqual({ overview: ORG_OVERVIEW })
  })

  test('GET /search returns no team B student, report or clip', () => {
    const results = runProbe('overview.search', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      const role = result.role
      expect(result.status, `role: ${role}`).toBe(200)
      expect(labels(result.body, 'students'), `role: ${role}`).toEqual(['Player A1', 'Player A2'])
      expect(labels(result.body, 'reports'), `role: ${role}`).toEqual([
        'Player report A1',
        'Player club handbook',
      ])
      expect(labels(result.body, 'analyses'), `role: ${role}`).toEqual([
        'Player clip A1',
        'Player clip unlinked',
      ])
      // The schedule is org-wide by design: it is a club calendar, not a player.
      expect(labels(result.body, 'schedule'), `role: ${role}`).toEqual([
        'Player squad session',
        'Player friendly',
      ])
    }
  })

  test('getStudent answers null for a team B student without probing the store', () => {
    const results = runProbe('student.get.teamB', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(404)
      expect(result.student, `role: ${result.role}`).toBeNull()
      // The scope is answered from the seam's list, so the out-of-scope id is
      // never used as a by-id probe.
      expect(result.store.scopeIds, `role: ${result.role}`).toBe(1)
      expect(result.store.getStudent, `role: ${result.role}`).toBe(0)
    }
  })

  test('getStudent still returns a team A student', () => {
    const results = runProbe('student.get.own', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect(result.student, `role: ${result.role}`).toBe(S_A1)
      expect(result.store.getStudent, `role: ${result.role}`).toBe(1)
    }
  })
})

// ── The out-of-scope wellness write ──────────────────────────────────────────

describe('a wellness check-in for another team is refused with nothing written', () => {
  test('POST wellness for a team B student is 403 and the store is untouched', () => {
    const results = runProbe('wellness.write.teamB', TEAM_MANAGERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(SCOPE_MESSAGE))
      expect(result.store.wellnessInsert, `role: ${result.role}`).toBe(0)
      // Not even a read: the refusal happens before the data layer is reached.
      expect(result.store.wellnessSelect, `role: ${result.role}`).toBe(0)
    }
  })

  test('POST wellness for a team A student still records the check-in', () => {
    const results = runProbe('wellness.write.own', TEAM_MANAGERS, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(201)
      expect(
        (result.body as { checkin: { student_id: string } }).checkin.student_id,
        `role: ${result.role}`,
      ).toBe(S_A1)
      expect(result.store.wellnessInsert, `role: ${result.role}`).toBe(1)
    }
  })
})

// ── The §5 medical boundary is unchanged ────────────────────────────────────

describe('the medical boundary on wellness is preserved', () => {
  test('a coach without medical.read is refused on its own team too', () => {
    // Scope must not become the answer for a caller the §5 boundary already
    // rejects: the medical message and the 403 come first, unchanged.
    const results = runProbe('wellness.read.own', TEAM_STAFF, [TEAM_A])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(MEDICAL_MESSAGE))
      expect(result.store.wellnessSelect, `role: ${result.role}`).toBe(0)
    }
  })

  test('an analyst or non-member cannot read wellness either', () => {
    for (const result of runProbe('wellness.read.teamB', ['analyst' as OrgMemberRole, null])) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(MEDICAL_MESSAGE))
      expect(result.store.wellnessSelect, `role: ${result.role}`).toBe(0)
    }
  })

  test('medical reads wellness org-wide', () => {
    const [result] = runProbe('wellness.read.teamB', ['medical'])
    expect(result.status).toBe(200)
    expect(result.store.wellnessSelect).toBe(1)
    // The team B check-in is returned: the medical role is not narrowed.
    const checkins = (result.body as { checkins: Array<{ student_id: string }> }).checkins
    expect(checkins.map((c) => c.student_id)).toEqual([S_B1])
  })

  test('the owner reads wellness org-wide', () => {
    const [result] = runProbe('wellness.read.teamB', ['owner'])
    expect(result.status).toBe(200)
    const checkins = (result.body as { checkins: Array<{ student_id: string }> }).checkins
    expect(checkins.map((c) => c.student_id)).toEqual([S_B1])
  })

  test('a role without player.manage is still refused before the scope check', () => {
    const results = runProbe(
      'wellness.write.own',
      ['assistant_coach' as OrgMemberRole, 'analyst' as OrgMemberRole, null],
      [TEAM_A],
    )
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(403)
      expect(result.body, `role: ${result.role}`).toEqual(forbidden(MANAGE_MESSAGE))
      expect(result.store.wellnessInsert, `role: ${result.role}`).toBe(0)
    }
  })
})

// ── Org staff and owners keep the org-wide answers ───────────────────────────

describe('org staff and owners are not narrowed', () => {
  test('analyst and medical get the org-wide overview', () => {
    const results = runProbe('overview.get', ORG_WIDE)
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect((result.body as { overview: unknown }).overview, `role: ${result.role}`).toEqual(
        ORG_OVERVIEW,
      )
      // `visibleStudentIds` short-circuits for an org-wide scope: the seam is
      // never asked, which is what "not narrowed" means at the store.
      expect(result.store.scopeIds, `role: ${result.role}`).toBe(0)
    }
  })

  test('analyst, medical and owner search the whole org', () => {
    const results = runProbe('overview.search', ORG_WIDE)
    for (const result of results) {
      const role = result.role
      expect(result.status, `role: ${role}`).toBe(200)
      expect(labels(result.body, 'students'), `role: ${role}`).toEqual([
        'Player A1',
        'Player A2',
        'Player B1',
      ])
      expect(labels(result.body, 'reports'), `role: ${role}`).toEqual([
        'Player report A1',
        'Player report B1',
        'Player club handbook',
      ])
      expect(labels(result.body, 'analyses'), `role: ${role}`).toEqual([
        'Player clip A1',
        'Player clip B1',
        'Player clip unlinked',
      ])
      expect(result.store.scopeIds, `role: ${role}`).toBe(0)
    }
  })

  test('analyst, medical and owner resolve a team B student by id', () => {
    const results = runProbe('student.get.teamB', ORG_WIDE)
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect(result.student, `role: ${result.role}`).toBe(S_B1)
      expect(result.store.getStudent, `role: ${result.role}`).toBe(1)
    }
  })
})

// ── The read's scope guard, which no membership can reach ───────────────────

describe('the wellness read keeps its scope guard (source structure)', () => {
  // The §5 matrix grants `medical.read` to exactly two roles — `owner` and
  // `medical` — and `resolveStudentScope` makes BOTH org-wide, so no real
  // membership can reach the read's scope branch and no request-level probe can
  // prove it. That is the point: it is defence in depth for a third medical role
  // arriving later, so this pin exists to stop it being deleted as dead code.
  // (Deleting the guard leaves every other test in this file green — that is
  // exactly what the structure pin is for.)
  const wellnessSrc = () =>
    readFileSync(join(import.meta.dir, '..', 'src', 'routes', 'org', 'wellness.ts'), 'utf8')
  const handlerSource = (method: 'get' | 'post') => {
    const src = wellnessSrc()
    const start = src.indexOf(`.${method}('/api/org/:auth0Id/students/:id/wellness'`)
    const end =
      method === 'get' ? src.indexOf(".post('/api/org/:auth0Id/students/:id/wellness'") : src.length
    return src.slice(start, end)
  }

  test('the read refuses an out-of-scope student before any check-in is read', () => {
    const get = handlerSource('get')
    expect(get).toContain('canSeeStudent')
    // The guard precedes the data read, so a refused caller never reaches it.
    expect(get.indexOf('canSeeStudent')).toBeGreaterThan(-1)
    expect(get.indexOf('canSeeStudent')).toBeLessThan(get.indexOf('listWellness'))
    expect(get).toContain(SCOPE_MESSAGE)
  })

  test('both handlers ask the seam for the caller scope', () => {
    const count = (wellnessSrc().match(/visibleStudentIds\(/g) ?? []).length
    expect(count).toBe(2)
  })
})

// ── A caller who manages no team sees nothing ────────────────────────────────

describe('a coach with no team assignment sees nothing', () => {
  test('the overview is all zeroes and never reaches the store', () => {
    const results = runProbe('overview.get', ['head_coach' as OrgMemberRole, null], [])
    for (const result of results) {
      expect(result.status, `role: ${result.role}`).toBe(200)
      expect((result.body as { overview: unknown }).overview, `role: ${result.role}`).toEqual(
        NOTHING_OVERVIEW,
      )
      expect(result.store, `role: ${result.role}`).toEqual(NO_STORE_QUERIES)
    }
  })

  test('the search returns no player at all', () => {
    const [result] = runProbe('overview.search', ['head_coach'], [])
    expect(result.status).toBe(200)
    expect(labels(result.body, 'students')).toEqual([])
    // "Sees nothing" outranks the org-wide schedule, matching the zero rollup.
    expect(labels(result.body, 'schedule')).toEqual([])
    // The only survivors would be rows attributed to no player, and even those
    // are suppressed here: a caller who manages no team gets no hits at all.
    expect(result.store).toEqual(NO_STORE_QUERIES)
  })

  test('getStudent answers null for every student', () => {
    const [result] = runProbe('student.get.teamB', ['head_coach'], [])
    expect(result.status).toBe(404)
    expect(result.student).toBeNull()
    expect(result.store).toEqual(NO_STORE_QUERIES)
  })

  test('no wellness check-in can be recorded', () => {
    // An unassigned coach is refused on scope; a non-member never gets that far,
    // because the capability floor (player.manage) answers first, unchanged.
    const [coach, outsider] = runProbe(
      'wellness.write.teamB',
      ['head_coach' as OrgMemberRole, null],
      [],
    )
    expect(coach.status).toBe(403)
    expect(coach.body).toEqual(forbidden(SCOPE_MESSAGE))
    expect(coach.store).toEqual(NO_STORE_QUERIES)
    expect(outsider.status).toBe(403)
    expect(outsider.body).toEqual(forbidden(MANAGE_MESSAGE))
    expect(outsider.store).toEqual(NO_STORE_QUERIES)
  })
})
