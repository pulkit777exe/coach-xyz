import { describe, expect, test } from 'bun:test'

// A share token is unauthenticated: whoever holds the link reads that analysis
// with no login. So minting or revoking one is a write about the player on the
// video, and the question is "may you publish this", not "may you see this".
//
// The route gated the token on `analysis.auth0_id !== verifiedAuth0Id`. Analysis
// rows are owned by the *org*, so that comparison could only ever pass for the
// org owner — every coach, the one caller the feature exists for, was refused,
// and the same bug blocked every revoke. It now compares against the org named
// in the path and asks the scope seam about the player.
//
// This probe runs with the identity boundary ON, unlike the account-tree probes:
// share only resolves a caller when `serviceGuardEnabled()`, and the guard
// captures SERVICE_TOKEN at import, so one process cannot have it both ways.
// That also means the mount-time role floor is live here, which is why the
// refusal cases distinguish "the matrix said no" from "scope said no".

type Row = {
  role: string | null
  route: string
  subject: string
  status: number
  touched: string[]
}

const run = async (roles: string[]): Promise<Row[]> => {
  const proc = Bun.spawn(['bun', 'run', 'tests/shareTokenScopeProbe.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, SHARE_SCOPE_ROLES: roles.join(',') },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  await proc.exited
  const last = out.trim().split('\n').at(-1) ?? ''
  if (!last.startsWith('{')) throw new Error(`probe produced no result: ${err}`)
  return (JSON.parse(last) as { rows: Row[] }).rows
}

/** Team staff, narrowed to team A by the scope seam. */
const TEAM_STAFF = ['coach', 'head_coach', 'assistant_coach']

const find = (rows: Row[], route: string): Row => {
  const row = rows.find((r) => r.route === route)
  if (!row) throw new Error(`no row for ${route}`)
  return row
}

describe('a share token is published and withdrawn per team', () => {
  test('a team coach can share their own team, and nobody else’s', async () => {
    for (const role of TEAM_STAFF) {
      const rows = await run([role])
      // This is the regression: the old ownership comparison refused exactly
      // this, so a coach could never share anything at all.
      const own = find(rows, 'mint own')
      expect(own.status, `${role} mint own`).toBe(201)
      expect(own.touched, `${role} must mint`).toEqual(['createShareToken'])

      const offTeam = find(rows, 'mint off-team')
      expect(offTeam.status, `${role} mint off-team`).toBe(403)
      // The refusal precedes the write: no token exists for an off-team video,
      // so there is no public link to hand around.
      expect(offTeam.touched, `${role} must not mint`).toEqual([])
    }
  })

  test('a team coach can withdraw their own link and not another team’s', async () => {
    for (const role of TEAM_STAFF) {
      const rows = await run([role])
      const own = find(rows, 'revoke own')
      expect(own.status, `${role} revoke own`).toBe(200)
      expect(own.touched, `${role} must revoke`).toEqual(['deleteShareToken'])

      expect(find(rows, 'revoke off-team').status, `${role} revoke off-team`).toBe(403)
      expect(find(rows, 'revoke off-team').touched, `${role} must not revoke`).toEqual([])
    }
  })

  test('another org’s link is refused whoever asks', async () => {
    // The cross-org check compares the token against the org in the path, not
    // against the caller, so this is the one refusal that is not about teams.
    for (const role of [...TEAM_STAFF, 'owner']) {
      const rows = await run([role])
      expect(find(rows, 'revoke foreign').status, role).toBe(403)
      expect(find(rows, 'revoke foreign').touched, role).toEqual([])
    }
  })

  test('a link whose analysis is gone cannot be scope-checked, so a team coach cannot touch it', async () => {
    // The player comes from the analysis row. With no row there is no student to
    // compare, and inventing one would be a guess — so a scoped caller is
    // refused and only an org-wide one may clean the record up.
    const coach = await run(['coach'])
    expect(find(coach, 'revoke vanished analysis').status).toBe(403)
    const owner = await run(['owner'])
    expect(find(owner, 'revoke vanished analysis').status).toBe(200)
  })
})

describe('the role floor still applies', () => {
  test('medical and a non-member are refused before the handler', async () => {
    // Both are outside the mount-time orgRoleGuard list, so this asserts the
    // floor rather than scope — the probe reports which by never touching the
    // store at all.
    for (const role of ['medical', '__non_member__']) {
      const rows = await run([role])
      for (const label of ['mint own', 'mint off-team', 'revoke own', 'revoke off-team']) {
        const row = find(rows, label)
        expect(row.status, `${role} ${label}`).toBe(403)
        expect(row.touched, `${role} ${label}`).toEqual([])
      }
    }
  })

  test('an owner is org-wide on both halves', async () => {
    const rows = await run(['owner'])
    expect(find(rows, 'mint own').status).toBe(201)
    expect(find(rows, 'mint off-team').status).toBe(201)
    expect(find(rows, 'revoke own').status).toBe(200)
    expect(find(rows, 'revoke off-team').status).toBe(200)
  })
})
