// Perf seed: 1 org, 2 teams, 500 students, 50k analyses, 200k attendance,
// 20k findings, 10k metrics — via generate_series (no array binding, fast).
//
// LOCAL ONLY. Refuses to run unless PERF_DATABASE_URL is set explicitly, so
// it can never seed live/Neon by accident. Run:
//   PERF_DATABASE_URL=postgres://coachxyz:coachxyz@localhost:55433/coachxyz \
//   DATABASE_URL=$PERF_DATABASE_URL bun scripts/seedPerf.ts

import { SQL } from 'bun'

import { ensureInitialized, setHistoryStoreConnectionForTests } from '../src/lib/historyStore'

const url = (process.env.PERF_DATABASE_URL ?? '').trim()
if (!url) {
  console.error('Refusing to run: set PERF_DATABASE_URL to a local Postgres explicitly.')
  process.exit(1)
}
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('Refusing to run: PERF_DATABASE_URL must be local.')
  process.exit(1)
}

const ORG = 'auth0|perf-org'
const TEAM_A = '00000000-0000-4000-8000-0000000000a1'
const TEAM_B = '00000000-0000-4000-8000-0000000000b1'

const db = new SQL(url)
setHistoryStoreConnectionForTests(db)
await ensureInitialized()

const t0 = Date.now()
const count = async (table: string, where = 'true'): Promise<number> => {
  const rows = await db.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table} where ${where};`)
  return rows[0]?.n ?? -1
}

// Fresh org slice (other tables keyed by server_job_id pattern below).
await db`delete from team_memberships where team_id in (${TEAM_A}::uuid, ${TEAM_B}::uuid);`
await db`delete from students where auth0_id = ${ORG};`
await db`delete from teams where id in (${TEAM_A}::uuid, ${TEAM_B}::uuid);`
await db`delete from findings where server_job_id like 'perf-%';`
await db`delete from player_events where server_job_id like 'perf-%';`
await db`delete from performance_metrics where auth0_id = ${ORG};`
await db`delete from attendance where auth0_id = ${ORG};`
await db`delete from analysis_history where auth0_id = ${ORG};`
await db`delete from org_members where org_auth0_id = ${ORG};`

await db`insert into teams (id, org_auth0_id, name) values (${TEAM_A}::uuid, ${ORG}, 'Perf A'), (${TEAM_B}::uuid, ${ORG}, 'Perf B');`
await db`insert into org_members (org_auth0_id, member_auth0_id, member_email, role, status) values (${ORG}, ${ORG}, 'owner@perf.test', 'owner', 'active');`

await db`
  insert into students (auth0_id, full_name, sport, team_id, status)
  select ${ORG}, 'Perf Student ' || g, (array['soccer','basketball'])[1 + (g % 2)],
    case when g % 2 = 0 then ${TEAM_A}::uuid else ${TEAM_B}::uuid end,
    'active'
  from generate_series(1, 500) g;
`
await db`
  insert into analysis_history (server_job_id, engine_job_id, model, auth0_id, student_id, requested_at, complete)
  select 'perf-' || g, 'eng-' || g, 'gemini-2.5-flash', ${ORG}, s.id,
    now() - ((g % 90) || ' days')::interval, true
  from generate_series(1, 50000) g
  join (select id, row_number() over (order by id) as rn from students where auth0_id = ${ORG}) s
    on s.rn = 1 + (g % 500);
`
await db`
  insert into attendance (auth0_id, student_id, session_date, status)
  select ${ORG}, s.id, (current_date - (g % 400))::date,
    (array['present','present','present','late','absent','excused'])[1 + (g % 6)]
  from (select id from students where auth0_id = ${ORG}) s
  cross join generate_series(1, 400) g
  on conflict do nothing;
`
await db`
  insert into findings (server_job_id, id, category, created_at)
  select a.server_job_id, a.server_job_id || '-f1', 'technique', a.requested_at
  from analysis_history a where a.auth0_id = ${ORG} limit 20000;
`
await db`
  insert into performance_metrics (auth0_id, student_id, metric_key, metric_value, measured_at)
  select ${ORG}, s.id, 'form_score', 5 + (g % 50) / 10.0,
    now() - ((g % 90) || ' days')::interval - ((g % 86400) || ' seconds')::interval
  from (select id, row_number() over (order by id) as rn from students where auth0_id = ${ORG}) s
  join generate_series(1, 10000) g on 1 + (g % 500) = s.rn;
`

const summary = {
  students: await count('students', `auth0_id = '${ORG}'`),
  analyses: await count('analysis_history', `auth0_id = '${ORG}'`),
  attendance: await count('attendance', `auth0_id = '${ORG}'`),
  findings: await count('findings', `server_job_id like 'perf-%'`),
  metrics: await count('performance_metrics', `auth0_id = '${ORG}'`),
  ms: Date.now() - t0,
}
console.log(JSON.stringify(summary))
await db.close()
