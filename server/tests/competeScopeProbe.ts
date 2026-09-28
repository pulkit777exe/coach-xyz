import { mock } from 'bun:test'

import type { OrgMemberRole } from '../src/lib/orgMembers'

// ── Match-scope probe ─────────────────────────────────────────────────────────
// Drives routes/org/compete.ts for a list of caller roles in a fresh process and
// prints `[{ role, status, deletes, created }]`. The caller
// (competeScope.test.ts) spawns it per case so the `mock.module` stubs stay out
// of the suite's shared module cache.
//
// The real `resolveCaller`, the real matrix and the real `canAccessTeam` run;
// only identity, the store and the data layer are stubbed.

const ORG_ID = 'auth0|org-owner'
const TEAM_A = '00000000-0000-0000-0000-0000000000a1'
const TEAM_B = '00000000-0000-0000-0000-0000000000b1'
const MATCH_A = '00000000-0000-0000-0000-0000000000a2'
const MATCH_B = '00000000-0000-0000-0000-0000000000b2'
const MATCH_CLUB = '00000000-0000-0000-0000-0000000000c9'

const roleTokens = (process.env.COMPETE_SCOPE_ROLES ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => (t === '__non_member__' ? null : (t as OrgMemberRole)))
const probeCase = process.env.COMPETE_SCOPE_CASE ?? ''
if (roleTokens.length === 0) {
  console.error('COMPETE_SCOPE_ROLES must list at least one role')
  process.exit(1)
}

const memberIdFor = (role: OrgMemberRole | null): string =>
  role ? `auth0|${role}-member` : 'auth0|outsider'

// Team staff belong to team A; org staff have no team assignment.
const TEAM_FOR_ROLE: Partial<Record<OrgMemberRole, string[]>> = {
  head_coach: [TEAM_A],
  coach: [TEAM_A],
  assistant_coach: [TEAM_A],
}

let currentRole: OrgMemberRole | null = null
const teamsFor = (role: OrgMemberRole | null): string[] => (role ? (TEAM_FOR_ROLE[role] ?? []) : [])

// ── Data-layer spy ───────────────────────────────────────────────────────────
let deletes = 0
let creates = 0

const match = (id: string, teamId: string | null) => ({
  id,
  org_auth0_id: ORG_ID,
  team_id: teamId,
  season_id: null,
  opponent: 'Rivals',
  match_on: '2026-03-01',
  location: null,
  result: null,
  created_at: new Date(0).toISOString(),
})

const MATCHES = [match(MATCH_A, TEAM_A), match(MATCH_B, TEAM_B), match(MATCH_CLUB, null)]

mock.module('../src/lib/orgMembers', () => ({
  getMemberRole: async (_orgAuth0Id: string, memberAuth0Id: string) =>
    memberAuth0Id === memberIdFor(currentRole) ? currentRole : null,
  listOrgMembers: async () => [],
  ensureOrgOwner: async () => {},
}))

mock.module('../src/lib/teams', () => ({
  getTeam: async (_orgAuth0Id: string, teamId: string) => ({ id: teamId }),
  listMemberTeamIdsInOrg: async (_orgAuth0Id: string) => teamsFor(currentRole),
  setStudentTeam: async () => null,
  getTeamMembership: async () => null,
  listTeams: async () => [
    { id: TEAM_A, name: 'A', sport: 'soccer' },
    { id: TEAM_B, name: 'B', sport: 'soccer' },
  ],
  listTeamMembers: async () => [],
  createTeam: async () => ({ id: TEAM_A, name: 'A', sport: 'soccer' }),
  deleteTeam: async () => true,
  renameTeam: async () => ({ id: TEAM_A, name: 'A', sport: 'soccer' }),
  addTeamMember: async () => ({ id: 'm1', team_id: TEAM_A, member_auth0_id: 'x' }),
  removeTeamMember: async () => true,
}))

mock.module('../src/lib/audit', () => ({
  auditRoute: () => undefined,
}))

mock.module('../src/lib/orgData', () => ({
  listSeasons: async () => [],
  createSeason: async () => ({}),
  deleteSeason: async () => true,
  listMatches: async (_orgAuth0Id: string, opts: { teamIds?: string[] } = {}) => {
    // Mirror the SQL scope rule: a team-less match is a club fixture and stays
    // visible, so an assertion on the club row proves the filter is not a
    // blanket "only my team's rows".
    if (opts.teamIds === undefined) return MATCHES
    return MATCHES.filter((m) => m.team_id === null || opts.teamIds!.includes(m.team_id))
  },
  getMatch: async (_orgAuth0Id: string, id: string) => MATCHES.find((m) => m.id === id) ?? null,
  createMatch: async () => {
    creates += 1
    return match(MATCH_A, TEAM_A)
  },
  deleteMatch: async (_orgAuth0Id: string, id: string) => {
    deletes += 1
    return MATCHES.some((m) => m.id === id)
  },
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const orgPath = 'auth0%7Corg-owner'
const competeRoute = (await import('../src/routes/org/compete')).default
const teamsRoute = (await import('../src/routes/teams')).default

type Case = {
  route: 'compete' | 'teams'
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  body?: unknown
}

const CASES: Record<string, Case> = {
  'read.list': { route: 'compete', method: 'GET', path: `/api/org/${orgPath}/matches` },
  'write.createOtherTeam': {
    route: 'compete',
    method: 'POST',
    path: `/api/org/${orgPath}/matches`,
    body: { team_id: TEAM_B, opponent: 'Rivals', match_on: '2026-03-01' },
  },
  'write.createOwnTeam': {
    route: 'compete',
    method: 'POST',
    path: `/api/org/${orgPath}/matches`,
    body: { team_id: TEAM_A, opponent: 'Rivals', match_on: '2026-03-01' },
  },
  'write.deleteOtherTeam': {
    route: 'compete',
    method: 'DELETE',
    path: `/api/org/${orgPath}/matches/${MATCH_B}`,
  },
  'read.teams': { route: 'teams', method: 'GET', path: `/api/org/${orgPath}/teams` },
}

const probe = CASES[probeCase]
if (!probe) {
  console.error(`unknown probe case: ${probeCase || '(unset)'}`)
  process.exit(1)
}

const results: Array<{
  role: OrgMemberRole | null
  status: number
  deletes: number
  creates: number
  body: unknown
}> = []

for (const role of roleTokens) {
  currentRole = role
  deletes = 0
  creates = 0

  const response = await (probe.route === 'compete' ? competeRoute : teamsRoute).handle(
    new Request(`http://localhost${probe.path}`, {
      method: probe.method,
      headers: {
        'content-type': 'application/json',
        'x-verified-auth0-id': memberIdFor(role),
      },
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
    }),
  )

  results.push({
    role,
    status: response.status,
    deletes,
    creates,
    body: await response.json().catch(() => null),
  })
}

console.log(JSON.stringify(results))
