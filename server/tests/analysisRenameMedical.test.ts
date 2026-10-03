import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// Renaming an analysis is a WRITE, and its response is a whole row — so the §5
// medical boundary travels with the response, exactly as it does on the GET of
// the same resource 30 lines away in routes/auth.ts.
//
// It did not. Both branches leaked: `updateAnalysisDisplayName` is
// `update … returning *`, and the empty-body branch performs NO write at all and
// still answered with the full row, so the leak did not require the caller to
// hold the rename capability. `admin` is deliberately not entitled either —
// permissions.ts withholds medical.read from it.
//
// This is the shape AGENTS.md already records for `linkAnalysisToStudent`
// ("a write that returns a whole row is also a read"), which was fixed at
// routes/org/students.ts. This was the un-fixed twin.
//
// The probe spawn is bounded by runProbeProcess so a wedged child is a probe
// failure carrying its output, not an opaque suite timeout (tests/spawnProbe.ts).

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'analysisRenameMedicalProbe.ts')

type Row = {
  role: string | null
  status: number
  renames: number
  hasInjuryRisk: boolean
  eventKeys: string[]
  summaryKeys: string[]
  displayName: string | null
}

const run = async (probeCase: string, roles: string[]): Promise<Row[]> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.RENAME_MEDICAL_CASE = probeCase
  env.RENAME_MEDICAL_ROLES = roles.join(',')
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe ${probeCase} failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  return lastJsonLine<{ cases: Row[] }>(proc.stdout).cases
}

// Roles that reach the handler at all. assistant_coach lacks the rename
// capability and is refused earlier, so it is not in these lists: a refusal must
// be attributable to the medical check rather than to a capability gate.
const CALLERS = ['coach', 'head_coach', 'analyst', 'admin', 'owner', 'medical']
// Entitled under resolveMedicalAccess: the owning account, or the medical role.
const ENTITLED = ['owner', 'medical']

describe('PATCH analyses/:jobId applies the medical boundary to its response', () => {
  for (const probeCase of ['rename', 'empty'] as const) {
    const what =
      probeCase === 'rename'
        ? 'the branch that writes and returns `returning *`'
        : 'the branch that performs no write at all'

    test(`${probeCase}: a non-medical member gets no injury_risk (${what})`, async () => {
      const results = await run(probeCase, CALLERS)
      expect(results.length).toBe(CALLERS.length)
      for (const r of results) {
        if (ENTITLED.includes(r.role!)) continue
        expect(r.hasInjuryRisk, `role ${r.role} received injury_risk`).toBe(false)
      }
    })

    test(`${probeCase}: the redaction is a redaction, not a dropped row`, async () => {
      // A response that dropped summary_json entirely would also satisfy "no
      // injury_risk", and that is a DIFFERENT bug. Pin that the non-wellness
      // payload survives: biomechanics and weighted_scoring ride alongside
      // injury_risk inside the same event, and the top-level keys stay.
      const results = await run(probeCase, CALLERS)
      for (const r of results) {
        if (ENTITLED.includes(r.role!)) continue
        expect(r.eventKeys, `role ${r.role} lost the event payload`).toContain('biomechanics')
        expect(r.eventKeys).toContain('weighted_scoring')
        expect(r.summaryKeys).toContain('form_score')
        expect(r.summaryKeys).toContain('top_tips')
      }
    })

    test(`${probeCase}: an entitled caller still receives the whole blob`, async () => {
      // The other direction: a cap that refuses everyone passes the two tests
      // above, so prove the medical role and the owning account lose nothing.
      const results = await run(probeCase, ENTITLED)
      for (const r of results) {
        expect(r.status).toBe(200)
        expect(r.hasInjuryRisk, `role ${r.role} was denied a key it is entitled to`).toBe(true)
        expect(r.eventKeys).toContain('biomechanics')
      }
    })
  }

  test('the rename still happens for a permitted caller', async () => {
    // Guard against "fix" by refusing the write outright: the capability is
    // unchanged, only the response body is filtered.
    const [owner] = await run('rename', ['owner'])
    expect(owner!.status).toBe(200)
    expect(owner!.renames).toBe(1)
    expect(owner!.displayName).toBe('Renamed')
  })

  test('the empty-body branch performs no write', async () => {
    const [owner] = await run('empty', ['owner'])
    expect(owner!.status).toBe(200)
    expect(owner!.renames).toBe(0)
  })
})
