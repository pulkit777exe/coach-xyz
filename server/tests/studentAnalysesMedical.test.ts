import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { hasPermission } from '../src/lib/permissions'
import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── §5 on the student's analysis LIST ───────────────────────────────────────
// `GET /api/org/:auth0Id/students/:id/analyses` returned `getStudentAnalyses(...)`
// through untouched, while its by-id twin (`GET /api/auth/user/:auth0Id/analyses/
// :jobId`) has always asked `resolveMedicalAccess` and stripped wellness keys with
// `redactWellness`. So any caller who could see the player — head coach, analyst,
// admin — also received `summary_json.shot_events[].injury_risk`, alongside the
// `biomechanics.joint_angles` and `weighted_scoring` that ride with it.
//
// The list projection added in 744c417 (`ANALYSES_LIST_COLUMNS`, `form_score`
// only) narrows what this route ships TODAY, which is why the gap is not visible
// in a snapshot of current behaviour. That is the reason this file pins the ROUTE
// and not the payload: the projection is a perf decision that can be revisited,
// and the probe's fixture store answers the full blob so the check is what holds.
//
// Entitlement is not invented here. It is `resolveMedicalAccess`, which admits the
// owning account and the `medical` role; `admin` holds every permission *except*
// `medical.read` (ROLE_PERMISSIONS), so it is redacted — asserted below against the
// same pure table the route resolves through, so the two cannot drift.
//
// The probe runs in a fresh process (its `mock.module` stubs must not leak) and
// drives one request per role inside it, so the whole matrix is one bounded spawn.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'studentAnalysesMedicalProbe.ts')

type ProbeCase = {
  name: string
  status: number
  form_score: number | null
  event_keys: string[] | null
  has_injury_risk: boolean
}

type ProbeResult = { cases: ProbeCase[] }

const runProbe = async (): Promise<Record<string, ProbeCase>> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  const result = lastJsonLine<ProbeResult>(proc.stdout)
  return Object.fromEntries(result.cases.map((c) => [c.name, c]))
}

const byName = await runProbe()

/** Roles/callers entitled to wellness signals by `resolveMedicalAccess`. */
const ENTITLED = ['orgOwner', 'ownerRole', 'medical'] as const
/** Callers who reach the handler but must never see `injury_risk`. */
const REDACTED = ['admin', 'headCoach', 'analyst'] as const
/** Callers who cannot see the player at all: an empty scope answers 404. */
const REFUSED = ['player', 'outsider'] as const

describe('the student analysis list enforces the §5 medical boundary', () => {
  test('the fixture store really could leak, so the assertions below mean something', () => {
    // Without this, "no injury_risk in the response" would be true for a store
    // that never had one — the same way a redaction test passes against a
    // projection that already removed the key. An entitled caller is the
    // witness: it receives the row exactly as the store holds it.
    expect(byName.medical!.has_injury_risk).toBe(true)
    expect(byName.medical!.event_keys).toContain('injury_risk')
  })

  for (const name of ENTITLED) {
    test(`${name} still receives the unredacted row`, () => {
      const result = byName[name]!
      expect(result.status).toBe(200)
      // A redaction is a REMOVAL, not a drop: the score and the biomechanics ride
      // with injury_risk, so their absence would mean the row was thrown away.
      expect(result.form_score).toBe(7)
      expect(result.event_keys).toContain('injury_risk')
      expect(result.event_keys).toContain('biomechanics')
    })
  }

  for (const name of REDACTED) {
    test(`${name} receives the row with injury_risk removed`, () => {
      const result = byName[name]!
      expect(result.status).toBe(200)
      expect(result.has_injury_risk).toBe(false)
      // Everything else survives: this is `redactWellness`, not an empty list.
      expect(result.form_score).toBe(7)
      expect(result.event_keys).toEqual(['biomechanics', 'result', 'timestamp', 'weighted_scoring'])
    })
  }

  for (const name of REFUSED) {
    test(`${name} cannot see the player at all (404, no rows)`, () => {
      // An empty scope is refused BEFORE the medical decision, so a player or an
      // outsider cannot even learn that the route has a medical branch.
      expect(byName[name]!.status).toBe(404)
      expect(byName[name]!.has_injury_risk).toBe(false)
      expect(byName[name]!.form_score).toBeNull()
    })
  }
})

describe('the entitlement rule is the one the codebase already has', () => {
  test('admin is refused medical.read, which is why it is redacted above', () => {
    expect(hasPermission('admin', 'medical.read')).toBe(false)
    expect(hasPermission('owner', 'medical.read')).toBe(true)
    expect(hasPermission('medical', 'medical.read')).toBe(true)
    // …and the route's outcome agrees with that table rather than with a second
    // hand-written role list.
    expect(byName.admin!.has_injury_risk).toBe(hasPermission('admin', 'medical.read'))
    expect(byName.medical!.has_injury_risk).toBe(hasPermission('medical', 'medical.read'))
  })
})
