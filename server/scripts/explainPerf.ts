// EXPLAIN (ANALYZE, BUFFERS) for the five hot reads against the perf seed.
// LOCAL ONLY — requires PERF_DATABASE_URL.

import { SQL } from 'bun'

const url = (process.env.PERF_DATABASE_URL ?? '').trim()
if (!url || !/localhost|127\.0\.0\.1/.test(url)) {
  console.error('Refusing to run: set PERF_DATABASE_URL to a local Postgres explicitly.')
  process.exit(1)
}

const ORG = 'auth0|perf-org'
const db = new SQL(url)

const plans: Array<[string, string]> = [
  [
    'history',
    `explain (analyze, buffers, format json) select a.server_job_id from analysis_history a left join video_conversations v on a.session_token = v.session_token where a.auth0_id = '${ORG}' order by a.requested_at desc limit 20 offset 0;`,
  ],
  [
    'roster',
    `explain (analyze, buffers, format json) select * from students where auth0_id = '${ORG}' and ('' = '' or status = null) order by full_name asc;`,
  ],
  [
    'attendance',
    `explain (analyze, buffers, format json) select a.* from attendance a join students s on s.id = a.student_id where a.auth0_id = '${ORG}' order by a.session_date desc limit 100;`,
  ],
  [
    'findings-trends',
    `explain (analyze, buffers, format json) select date_trunc('day', created_at)::date as day, count(*) from findings where server_job_id in (select server_job_id from analysis_history where auth0_id = '${ORG}' limit 1000) group by 1 order by 1 desc limit 30;`,
  ],
  [
    'overview-students',
    `explain (analyze, buffers, format json) select count(*) from students where auth0_id = '${ORG}';`,
  ],
]

for (const [name, sql] of plans) {
  const rows = await db.unsafe<{ [k: string]: unknown }[]>(sql)
  const plan = (
    (rows[0] as { 'QUERY PLAN': Array<{ Plan: { [k: string]: unknown } }> })['QUERY PLAN'][0] as {
      Plan: { [k: string]: unknown }
    }
  ).Plan
  const walk: string[] = []
  const visit = (node: { [k: string]: unknown }, depth: number): void => {
    walk.push(
      `${'  '.repeat(depth)}${node['Node Type']} ${node['Relation Name'] ?? ''} rows=${node['Actual Rows']} loops=${node['Actual Loops']} time=${node['Actual Total Time']}ms`,
    )
    for (const child of ((node['Plans'] ?? []) as Array<{ [k: string]: unknown }>)) {
      visit(child, depth + 1)
    }
  }
  visit(plan, 0)
  console.log(`--- ${name}: exec=${plan['Execution Time']}ms planning=${plan['Planning Time']}ms`);
  console.log(walk.slice(0, 8).join('\n'))
}
await db.close()
