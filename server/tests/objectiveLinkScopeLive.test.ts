import { beforeEach, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { createObjective, listObjectives } from '../src/lib/org/objectives'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Objectives: the analysis-linked columns are org-owned ─────────────────────
// `training_objectives` carries `finding_id` and `analysis_job_id` as free text
// with no foreign key, so `createObjective` accepted any string. Neither column
// identifies a row on its own terms: an analysis is owned by an org through
// `analysis_history.auth0_id`, and a finding only through a join to its
// analysis — and `findings_unique` is `(server_job_id, id)`, so the SAME finding
// id can exist under two analyses in two orgs.
//
// So this is data integrity rather than a read leak (the objective row itself is
// org-scoped by every list path), but the stored value is a durable
// cross-tenant POINTER: enough to probe whether a given server_job_id or finding
// id exists in another tenant, and enough to attach one tenant's findings to
// another tenant's objective.
//
// Live Postgres, and this file spawns nothing: the rule IS SQL — the org
// predicate, and the fact that one finding id resolves in two orgs. No stub of
// `db` can observe either. See the note at the top of
// orgTeamScopeLive.test.ts for why the live half lives in its own file rather
// than beside the probe-spawning half.

const ORG = 'auth0|objlink-org'
const OTHER = 'auth0|objlink-other'
const STUDENT = '00000000-0000-4000-8000-0000000000a1'

const JOB_OWN = 'objlink-job-own'
const JOB_FOREIGN = 'objlink-job-foreign'
// The same finding id under both analyses. Legal per `findings_unique`, which is
// scoped to (server_job_id, id) — and the reason the org predicate cannot be
// skipped: an id-level existence check would be answered by the victim's copy.
const FINDING_SHARED = 'f-shared'
// Exists ONLY under the foreign analysis, so it separates "this id exists
// somewhere" from "this id exists here" — and it is what shows the finding
// column is checked on its own, with no analysis_job_id to lean on.
const FINDING_FOREIGN = 'f-foreign-only'

describeLiveDb('objective analysis links are org-owned', () => {
  const seed = async (db: SQL) => {
    await db`delete from training_objectives where org_auth0_id in (${ORG}, ${OTHER})`
    await db`delete from findings where id in (${FINDING_SHARED}, ${FINDING_FOREIGN})`
    await db`delete from analysis_history where server_job_id in (${JOB_OWN}, ${JOB_FOREIGN})`
    // The student guard runs before the link guards, so it has to pass — these
    // cases are about the link columns, not the roster.
    await db`delete from students where id = ${STUDENT}::uuid`
    await db`
      insert into students (id, auth0_id, full_name, status)
      values (${STUDENT}::uuid, ${ORG}, 'Link Test', 'active');
    `
    await db`
      insert into analysis_history (server_job_id, engine_job_id, auth0_id, model, student_id)
      values
        (${JOB_OWN}, 'eng-own', ${ORG}, 'm', ${STUDENT}::uuid),
        (${JOB_FOREIGN}, 'eng-foreign', ${OTHER}, 'm', ${STUDENT}::uuid);
    `
    await db`
      insert into findings (id, server_job_id, category)
      values
        (${FINDING_SHARED}, ${JOB_OWN}, 'technique'),
        (${FINDING_SHARED}, ${JOB_FOREIGN}, 'technique'),
        (${FINDING_FOREIGN}, ${JOB_FOREIGN}, 'technique');
    `
  }

  const cleanup = async (db: SQL) => {
    await db`delete from training_objectives where org_auth0_id in (${ORG}, ${OTHER})`
    await db`delete from findings where id in (${FINDING_SHARED}, ${FINDING_FOREIGN})`
    await db`delete from analysis_history where server_job_id in (${JOB_OWN}, ${JOB_FOREIGN})`
    await db`delete from students where id = ${STUDENT}::uuid`
  }

  useLiveTestDb({ seed, cleanup })

  // Each case asserts on the whole org's objective list, so the rows must not
  // accumulate — otherwise "writes no row" would pass because the negative case
  // ran first against an empty table. beforeEach rather than afterEach: a
  // failure mid-case then cannot leave state for the next one.
  beforeEach(async () => {
    const { withHistoryStoreOrThrow } = await import('../src/lib/historyStore')
    await withHistoryStoreOrThrow(async (db) => {
      await db`delete from training_objectives where org_auth0_id in (${ORG}, ${OTHER})`
    })
  })

  const titles = async (): Promise<string[]> =>
    (await listObjectives(ORG))
      .map((o) => o.title)
      .sort()

  // ── The negative direction: a cross-org link is refused ────────────────────
  test("another org's analysis_job_id is refused and writes no row", async () => {
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      analysis_job_id: JOB_FOREIGN,
      title: 'foreign analysis',
    })
    expect(row).toBeNull()
    expect(await titles()).toEqual([])
  })

  test("another org's analysis_job_id is refused even when the finding id is the caller's own", async () => {
    // The two columns are checked INDEPENDENTLY. FINDING_SHARED is org-owned, so
    // a check that only validated the pair (or only the finding) would accept
    // this row and store a pointer into another tenant's analysis.
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      finding_id: FINDING_SHARED,
      analysis_job_id: JOB_FOREIGN,
      title: 'own finding, foreign analysis',
    })
    expect(row).toBeNull()
    expect(await titles()).toEqual([])
  })

  test("a finding_id with no analysis_job_id is checked on its own", async () => {
    // This id exists only under the foreign analysis, so nothing but the org
    // predicate can refuse it — no analysis link to lean on.
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      finding_id: FINDING_FOREIGN,
      title: 'foreign finding only',
    })
    expect(row).toBeNull()
    expect(await titles()).toEqual([])
  })

  test('a finding id that exists nowhere is refused', async () => {
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      finding_id: 'f-does-not-exist',
      title: 'missing finding',
    })
    expect(row).toBeNull()
    expect(await titles()).toEqual([])
  })

  test('an analysis_job_id that exists nowhere is refused', async () => {
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      analysis_job_id: 'job-does-not-exist',
      title: 'missing analysis',
    })
    expect(row).toBeNull()
    expect(await titles()).toEqual([])
  })

  // ── The legitimate callers still work ─────────────────────────────────────
  test("the org's own analysis_job_id is accepted and stored verbatim", async () => {
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      analysis_job_id: JOB_OWN,
      title: 'own analysis',
    })
    expect(row?.analysis_job_id).toBe(JOB_OWN)
    expect(await titles()).toEqual(['own analysis'])
  })

  test("the org's own finding_id is accepted alongside its analysis", async () => {
    // Exactly what the web sends (ObjectivesSection): the finding picked out of
    // `orgStudentFindings` and that finding's own `server_job_id`. Both resolve
    // here even though the other org holds an identically-id'd copy of the
    // finding — the positive direction for the case above.
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      finding_id: FINDING_SHARED,
      analysis_job_id: JOB_OWN,
      title: 'own finding',
    })
    expect(row?.finding_id).toBe(FINDING_SHARED)
    expect(row?.analysis_job_id).toBe(JOB_OWN)
    expect(await titles()).toEqual(['own finding'])
  })

  test("the org's own finding_id is accepted with no analysis_job_id at all", async () => {
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      finding_id: FINDING_SHARED,
      title: 'own finding only',
    })
    expect(row?.finding_id).toBe(FINDING_SHARED)
    expect(row?.analysis_job_id).toBeNull()
    expect(await titles()).toEqual(['own finding only'])
  })

  test('an objective with neither link is unaffected', async () => {
    // Most objectives are authored from a title alone, so the guard must cost
    // that path nothing — which is also why it only runs when a link is present.
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      title: 'no links',
    })
    expect(row?.finding_id).toBeNull()
    expect(row?.analysis_job_id).toBeNull()
    expect(await titles()).toEqual(['no links'])
  })

  test('a blank link is treated as absent rather than stored as whitespace', async () => {
    // Normalized once and the SAME value checked and written: validating
    // `finding_id?.trim()` while inserting `finding_id?.slice(0, 200)` would let
    // `'   '` skip the check and still store three spaces.
    const row = await createObjective(ORG, ORG, {
      student_id: STUDENT,
      finding_id: '   ',
      analysis_job_id: '',
      title: 'blank links',
    })
    expect(row).not.toBeNull()
    expect(row?.finding_id).toBeNull()
    expect(row?.analysis_job_id).toBeNull()
    expect(await titles()).toEqual(['blank links'])
  })
})
