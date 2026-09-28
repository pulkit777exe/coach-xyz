import { afterEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import { deleteStudent } from '../src/lib/org/students'
import { getUserAnalyses } from '../src/lib/analyses'
import studentsRoutes from '../src/routes/org/students'

// ── Student delete: transactional erasure, club history preserved ───────────
// Private rows (wellness, objectives, plans, team links) go with the student;
// analyses and player events stay with the club, unlinked. The student row is
// claimed for the org before anything it points at is touched, so a foreign
// id deletes nothing.
//
// Part A is hermetic: the real route + real data layer run against a
// fixture-backed stub connection (no probe process needed — nothing here
// mocks a module, so there is no module-cache leak to isolate).
// Part B runs against an ephemeral Postgres (TEST_DATABASE_URL) because no
// fixture can prove atomicity or FK cascades.

const ORG = 'auth0|delete-org'
const OTHER_ORG = 'auth0|other-org'
const COACH = 'auth0|delete-coach'
const TEAM = '00000000-0000-4000-8000-0000000000d1'
const STUDENT = '00000000-0000-4000-8000-0000000000d2'
const OUTSIDER = '00000000-0000-4000-8000-0000000000d3'

const serviceToken = process.env.SERVICE_TOKEN ?? ''
const deleteRequest = (org: string, id: string, verified: string): Request =>
  new Request(`http://localhost/api/org/${org}/students/${id}`, {
    method: 'DELETE',
    headers: {
      'x-verified-auth0-id': verified,
      ...(serviceToken ? { 'x-service-token': serviceToken } : {}),
    },
  })

type Mutation = { sql: string; values: unknown[] }

const useFixtureStore = (opts: {
  studentOrg?: string
  coachTeams?: string[]
  visibleIds?: string[]
}): { mutations: Mutation[]; audits: Mutation[] } => {
  const { studentOrg = ORG, coachTeams = [TEAM], visibleIds = [STUDENT] } = opts
  const mutations: Mutation[] = []
  const audits: Mutation[] = []
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    if (/insert into audit_logs/.test(sql)) {
      audits.push({ sql, values })
      return []
    }
    // Mutations first: `delete from team_memberships …` contains
    // "from team_memberships" and would otherwise match a select branch below.
    if (/^(delete|update|insert)/i.test(sql.trim())) {
      mutations.push({ sql, values })
      return []
    }
    if (/for update/.test(sql)) {
      const ok = values.includes(studentOrg) && values.includes(STUDENT) && studentOrg === ORG
      return ok ? [{ id: STUDENT }] : []
    }
    if (/team_id = any/.test(sql)) {
      return visibleIds.map((id) => ({ id }))
    }
    if (/from team_memberships/.test(sql)) {
      return coachTeams.map((team_id) => ({ team_id }))
    }
    if (/from org_members/.test(sql)) {
      return values.includes(COACH) ? [{ role: 'coach' }] : []
    }
    if (/from students/.test(sql)) {
      return values.includes(STUDENT) && studentOrg === ORG
        ? [{ id: STUDENT, auth0_id: ORG, full_name: 'Dele Temme' }]
        : []
    }
    return []
  }) as unknown as SQL
  const stub = Object.assign(tag, {
    begin: (fn: (tx: unknown) => unknown) => fn(tag),
    connect: async () => {},
    unsafe: async () => [],
    close: async () => {},
  }) as unknown as SQL
  restore = setHistoryStoreConnectionForTests(stub)
  return { mutations, audits }
}

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

describe('DELETE /students/:id (hermetic)', () => {
  test('a malformed id is a 400 before any store write', async () => {
    const { mutations } = useFixtureStore({})
    const res = await studentsRoutes.handle(deleteRequest(ORG, 'not-a-uuid', ORG))
    expect(res.status).toBe(400)
    expect(mutations).toEqual([])
  })

  test('an out-of-scope coach gets 403 and nothing changes', async () => {
    const { mutations, audits } = useFixtureStore({ visibleIds: [OUTSIDER] })
    const res = await studentsRoutes.handle(deleteRequest(ORG, STUDENT, COACH))
    expect(res.status).toBe(403)
    expect(mutations).toEqual([])
    expect(audits).toEqual([])
  })

  test('an in-scope delete audits player.deleted with the student name', async () => {
    const { mutations, audits } = useFixtureStore({})
    const res = await studentsRoutes.handle(deleteRequest(ORG, STUDENT, COACH))
    expect(res.status).toBe(200)
    const tables = mutations.map((m) => m.sql)
    for (const table of [
      'wellness_checkins',
      'training_objectives',
      'training_plans',
      'team_memberships',
      'analysis_history',
      'player_events',
    ]) {
      expect(tables.some((sql) => sql.includes(table)), table).toBe(true)
    }
    expect(audits.length).toBe(1)
    expect(audits[0].values).toContain('player.deleted')
    expect(audits[0].values).toContain(STUDENT)
  })

  test("another org's student id deletes nothing", async () => {
    const { mutations, audits } = useFixtureStore({ studentOrg: OTHER_ORG })
    const res = await studentsRoutes.handle(deleteRequest(ORG, STUDENT, ORG))
    expect(res.status).toBe(404)
    expect(mutations).toEqual([])
    expect(audits).toEqual([])
  })
})

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL)

;(hasTestDb ? describe : describe.skip)('deleteStudent against ephemeral Postgres', () => {
  const JOB = 'job-delete-probe'

  const seed = async (db: SQL, studentId: string) => {
    // Idempotent: a previous red run may have left this student behind.
    // team_memberships / wellness / objectives / plans have no FK to
    // students, so they survive a raw student delete and must go first.
    await db`delete from team_memberships where student_id = ${studentId}::uuid;`
    await db`delete from wellness_checkins where student_id = ${studentId}::uuid;`
    await db`delete from training_objectives where student_id = ${studentId}::uuid;`
    await db`delete from training_plans where student_id = ${studentId}::uuid;`
    await db`delete from analysis_history where server_job_id = ${JOB};`
    await db`delete from player_events where server_job_id = ${JOB};`
    await db`delete from reports where title = 'rep';`
    await db`delete from students where id = ${studentId}::uuid;`
    await db`insert into students (id, auth0_id, full_name, team_id) values (${studentId}::uuid, ${ORG}, 'Ephe Meral', ${TEAM}::uuid);`
    await db`insert into wellness_checkins (org_auth0_id, student_id) values (${ORG}, ${studentId}::uuid);`
    await db`insert into training_objectives (org_auth0_id, student_id, title) values (${ORG}, ${studentId}::uuid, 'obj');`
    await db`insert into training_plans (org_auth0_id, student_id, title) values (${ORG}, ${studentId}::uuid, 'plan');`
    await db`insert into team_memberships (team_id, student_id, role) values (${TEAM}::uuid, ${studentId}::uuid, 'player');`
    await db`insert into analysis_history (server_job_id, engine_job_id, model, auth0_id, student_id) values (${JOB}, 'eng-1', 'm', ${ORG}, ${studentId}::uuid);`
    await db`insert into player_events (org_auth0_id, server_job_id, student_id, category) values (${ORG}, ${JOB}, ${studentId}::uuid, 'shot');`
    await db`insert into attendance (auth0_id, student_id, session_date, status) values (${ORG}, ${studentId}::uuid, '2026-09-01', 'present');`
    await db`insert into performance_metrics (auth0_id, student_id, metric_key, metric_value) values (${ORG}, ${studentId}::uuid, 'k', 1);`
    await db`insert into player_consents (student_id) values (${studentId}::uuid);`
    await db`insert into reports (auth0_id, student_id, title) values (${ORG}, ${studentId}::uuid, 'rep');`
  }

  const useEphemeral = async (): Promise<SQL> => {
    const db = new SQL(process.env.TEST_DATABASE_URL as string)
    restore = setHistoryStoreConnectionForTests(db)
    // The schema is created by the sole DDL owner on first store use; raw
    // seeds below bypass the store, so initialize explicitly first.
    await ensureInitialized()
    return db
  }

  test('private rows go, club analyses stay unlinked and listed', async () => {
    const db = await useEphemeral()
    // Schema comes from the sole DDL owner; team must exist for the membership.
    await db`insert into teams (id, org_auth0_id, name) values (${TEAM}::uuid, ${ORG}, 'T') on conflict (id) do nothing;`
    await seed(db, STUDENT)

    expect(await deleteStudent(ORG, STUDENT)).toBe(true)

    const student = await db`select id from students where id = ${STUDENT}::uuid;`
    expect(student.length).toBe(0)
    // Table names cannot be bound parameters — one explicit query per table.
    expect(
      (await db`select id from wellness_checkins where student_id = ${STUDENT}::uuid;`).length,
    ).toBe(0)
    expect(
      (await db`select id from training_objectives where student_id = ${STUDENT}::uuid;`).length,
    ).toBe(0)
    expect(
      (await db`select id from training_plans where student_id = ${STUDENT}::uuid;`).length,
    ).toBe(0)
    const memberships =
      await db`select id from team_memberships where student_id = ${STUDENT}::uuid;`
    expect(memberships.length).toBe(0)
    // Cascades and set-nulls the schema owns.
    const attendance = await db`select id from attendance where student_id = ${STUDENT}::uuid;`
    expect(attendance.length).toBe(0)
    const metrics =
      await db`select id from performance_metrics where student_id = ${STUDENT}::uuid;`
    expect(metrics.length).toBe(0)
    const consents = await db`select student_id from player_consents where student_id = ${STUDENT}::uuid;`
    expect(consents.length).toBe(0)
    const reports = await db`select student_id from reports where title = 'rep';`
    expect(reports.length).toBe(1)
    expect(reports[0].student_id).toBeNull()
    // Club history survives, unlinked — and still listed, org-wide and
    // unlinked-only (the empty-scope dashboard view).
    const analyses =
      await db`select server_job_id, student_id from analysis_history where server_job_id = ${JOB};`
    expect(analyses.length).toBe(1)
    expect(analyses[0].student_id).toBeNull()
    const events = await db`select student_id from player_events where server_job_id = ${JOB};`
    expect(events.length).toBe(1)
    expect(events[0].student_id).toBeNull()
    const orgWide = await getUserAnalyses(ORG, 50, 0)
    expect(orgWide.map((a) => a.server_job_id)).toContain(JOB)
    const unlinkedOnly = await getUserAnalyses(ORG, 50, 0, { studentIds: [] })
    expect(unlinkedOnly.map((a) => a.server_job_id)).toContain(JOB)

    await db`delete from analysis_history where server_job_id = ${JOB};`
    await db`delete from player_events where server_job_id = ${JOB};`
    await db`delete from reports where title = 'rep';`
  })

  test("another org's id deletes nothing", async () => {
    const db = await useEphemeral()
    await db`insert into teams (id, org_auth0_id, name) values (${TEAM}::uuid, ${ORG}, 'T') on conflict (id) do nothing;`
    await seed(db, OUTSIDER)
    expect(await deleteStudent(OTHER_ORG, OUTSIDER)).toBe(false)
    const rows = await db`select id from students where id = ${OUTSIDER}::uuid;`
    expect(rows.length).toBe(1)
    expect(await deleteStudent(ORG, OUTSIDER)).toBe(true)
    await db`delete from analysis_history where server_job_id = ${JOB};`
    await db`delete from player_events where server_job_id = ${JOB};`
    await db`delete from reports where title = 'rep';`
  })

  test('a mid-transaction failure rolls everything back', async () => {
    const db = await useEphemeral()
    await db`insert into teams (id, org_auth0_id, name) values (${TEAM}::uuid, ${ORG}, 'T') on conflict (id) do nothing;`
    await seed(db, STUDENT)
    await db.unsafe(`create or replace function fail_plans() returns trigger as $$
      begin raise exception 'injected'; end; $$ language plpgsql;`)
    await db.unsafe(
      `create trigger fail_plans_trigger before delete on training_plans for each row execute function fail_plans();`,
    )
    try {
      await expect(deleteStudent(ORG, STUDENT)).rejects.toThrow()
      const student = await db`select id from students where id = ${STUDENT}::uuid;`
      expect(student.length).toBe(1)
      const wellness =
        await db`select id from wellness_checkins where student_id = ${STUDENT}::uuid;`
      expect(wellness.length).toBe(1)
    } finally {
      await db.unsafe(`drop trigger fail_plans_trigger on training_plans;`)
      await db.unsafe(`drop function fail_plans();`)
    }
    // Cleanup through the real path once the fault is gone.
    expect(await deleteStudent(ORG, STUDENT)).toBe(true)
    await db`delete from analysis_history where server_job_id = ${JOB};`
    await db`delete from player_events where server_job_id = ${JOB};`
    await db`delete from reports where title = 'rep';`
  })
})
