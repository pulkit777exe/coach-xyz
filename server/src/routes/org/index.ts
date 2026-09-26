import { Elysia } from 'elysia'

import students from './students'
import attendance from './attendance'
import schedule from './schedule'
import reports from './reports'
import objectives from './objectives'
import billing from './billing'
import compete from './compete'
import plans from './plans'
import wellness from './wellness'
import performance from './performance'
import overview from './overview'
import settings from './settings'

// Org domain routes, one module per subdomain (see report candidate 4).
// serviceGuard runs inside each module; the orgRoleGuard composes at the
// app level in index.ts, unchanged.
export default new Elysia()
  .use(students)
  .use(attendance)
  .use(schedule)
  .use(reports)
  .use(objectives)
  .use(billing)
  .use(compete)
  .use(plans)
  .use(wellness)
  .use(performance)
  .use(overview)
  .use(settings)
