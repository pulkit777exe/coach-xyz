import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// `/api/email/:auth0Id/*` sat behind `serviceGuard` alone, which proves only
// that the caller is *a* member of the org — membership, not authorization.
// So any member, including a `player`, could ask for the whole club's
// attendance (omit `student_id` and the read is org-wide) or any report by id,
// and have it mailed to an address they chose. That bypassed both the
// permission matrix and team scope, and hiding the button in the UI did nothing
// about it.
//
// Each case spawns a probe process, bounded by runProbeProcess so a wedged
// child is a probe failure carrying its output rather than an opaque suite
// timeout (see tests/spawnProbe.ts), and so its `mock.module` stubs stay out of
// the suite's shared module cache. The probe keeps the real `resolveCaller`, the
// real matrix and the real scope seam, and captures the mail instead of
// sending it.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'emailRouteGuardsProbe.ts')

type Row = {
  role: string | null
  status: number
  attendanceOpts: Record<string, unknown> | null
  sentTo: string | null
  sentHtml: string | null
  reportId: string | null
  inviteAddresses: string[]
  studentLookupCount: number
}

const run = async (probeCase: string, roles: string[]): Promise<Row[]> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.EMAIL_GUARD_CASE = probeCase
  env.EMAIL_GUARD_ROLES = roles.join(',')
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe ${probeCase} failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<Row[]>(proc.stdout)
}

const STUDENT_A = '00000000-0000-0000-0000-0000000000a1'
/** Roles that may not email an attendance sheet at all. */
const NO_ATTENDANCE_WRITE = ['analyst', 'medical', 'player', '__non_member__']
/** Roles that hold attendance.write. */
const CAN_ATTENDANCE_WRITE = ['owner', 'admin', 'coach', 'head_coach', 'assistant_coach']
/** Team staff, narrowed to team A. */
const TEAM_STAFF = ['coach', 'head_coach', 'assistant_coach']

describe('emailing an attendance sheet needs attendance.write', () => {
  test('analyst, medical, player and a stranger are refused before any read', async () => {
    for (const role of NO_ATTENDANCE_WRITE) {
      const [row] = await run('attendance.org', [role])
      expect(row.status, `role ${role}`).toBe(403)
      // Nothing was read and nothing was sent: no data left the process.
      expect(row.attendanceOpts, `role ${role} must not read`).toBeNull()
      expect(row.sentTo, `role ${role} must not send`).toBeNull()
      expect(row.sentHtml, `role ${role} must not send`).toBeNull()
    }
  })

  test('roles holding the capability are allowed', async () => {
    for (const role of CAN_ATTENDANCE_WRITE) {
      const [row] = await run('attendance.org', [role])
      expect(row.status, `role ${role}`).toBe(200)
    }
  })
})

describe('the attendance sheet is capped at the caller scope', () => {
  test('a team coach sends only their own team, never the other team', async () => {
    const [coach] = await run('attendance.org', TEAM_STAFF)
    expect(coach.status).toBe(200)
    // The scope reached the data layer instead of being org-wide (null).
    expect(coach.attendanceOpts?.studentIds).toEqual([STUDENT_A])
    expect(coach.sentHtml).toContain('Player A')
    // The other team's student is not in the mail at all.
    expect(coach.sentHtml).not.toContain('Player B')
  })

  test('an org-wide caller keeps the whole org', async () => {
    const [owner] = await run('attendance.org', ['owner'])
    expect(owner.attendanceOpts?.studentIds).toBeNull()
    expect(owner.sentHtml).toContain('Player A')
    expect(owner.sentHtml).toContain('Player B')
  })

  test('a team coach cannot name a student outside their teams', async () => {
    const [coach] = await run('attendance.otherStudent', TEAM_STAFF)
    expect(coach.status).toBe(403)
    expect(coach.sentTo).toBeNull()
    expect(coach.attendanceOpts).toBeNull()
  })

  test('a team coach can still name a student on their own team', async () => {
    const [coach] = await run('attendance.oneStudent', TEAM_STAFF)
    expect(coach.status).toBe(200)
    expect(coach.sentTo).toBe('sheet@example.com')
  })
})

describe('emailing a report needs report.create and the report in scope', () => {
  test('a player cannot mail out a report, despite holding report.read', async () => {
    const [player] = await run('report.student', ['player'])
    expect(player.status).toBe(403)
    expect(player.sentTo).toBeNull()
  })

  test('an analyst may mail one: report.create is theirs by policy', async () => {
    // Authoring reports is part of the analyst role, and they are an org-wide
    // reader, so this is allowed. What an analyst must not gain is a *write*
    // elsewhere — the capability check is what separates them from a player,
    // who holds report.read only.
    const [analyst] = await run('report.student', ['analyst'])
    expect(analyst.status).toBe(200)
  })

  test('a coach can mail a report about their own team', async () => {
    const [coach] = await run('report.student', TEAM_STAFF)
    expect(coach.status).toBe(200)
    expect(coach.sentTo).toBe('someone@example.com')
  })

  test('a team coach cannot mail an org-wide report', async () => {
    // It summarizes every team, so it is not theirs to send.
    const [coach] = await run('report.orgLevel', TEAM_STAFF)
    expect(coach.status).toBe(403)
    expect(coach.sentTo).toBeNull()
  })

  test('an org-wide caller can still mail an org-wide report', async () => {
    const [owner] = await run('report.orgLevel', ['owner'])
    expect(owner.status).toBe(200)
  })
})

describe('sending invites needs org.invite', () => {
  test('a coach is refused: invites are an owner/admin capability', async () => {
    const [coach] = await run('invite.any', TEAM_STAFF)
    expect(coach.status).toBe(403)
  })

  test('a player is refused', async () => {
    const [player] = await run('invite.any', ['player'])
    expect(player.status).toBe(403)
  })

  test('an owner may send them', async () => {
    const [owner] = await run('invite.any', ['owner'])
    expect(owner.status).toBe(200)
  })
})
