import { withHistoryStoreOrThrow as withHistoryStore, ensureInitialized } from "./supabaseHistory"
import type { DashboardAnalysis } from "./supabaseHistory"
import {
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
} from "./orgEnums"
import type { AttendanceStatus } from "./orgEnums"
export type {
  AttendanceStatus,
  EventStatus,
  EventType,
  ReportType,
  StudentStatus,
} from "./orgEnums"

// ── Types ────────────────────────────────────────────────────────────────────

export type Student = {
  id: string
  auth0_id: string
  full_name: string
  email: string | null
  phone: string | null
  sport: string | null
  position: string | null
  jersey_number: number | null
  date_of_birth: string | null
  gender: string | null
  guardian_name: string | null
  guardian_phone: string | null
  notes: string | null
  status: (typeof STUDENT_STATUSES)[number]
  joined_on: string | null
  created_at: string
  updated_at: string
}

export type AttendanceRecord = {
  id: string
  auth0_id: string
  student_id: string
  session_date: string
  status: AttendanceStatus
  note: string | null
  created_at: string
  updated_at: string
}

export type AttendanceWithStudent = AttendanceRecord & {
  full_name: string | null
  sport: string | null
}

export type ScheduleEvent = {
  id: string
  auth0_id: string
  title: string
  event_type: (typeof EVENT_TYPES)[number]
  starts_at: string
  ends_at: string | null
  location: string | null
  description: string | null
  status: (typeof EVENT_STATUSES)[number]
  created_at: string
  updated_at: string
}

export type ReportRecord = {
  id: string
  auth0_id: string
  student_id: string | null
  report_type: (typeof REPORT_TYPES)[number]
  title: string
  period_start: string | null
  period_end: string | null
  content_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PerformanceMetric = {
  id: string
  auth0_id: string
  student_id: string
  metric_key: string
  metric_value: number
  unit: string | null
  source_analysis_id: string | null
  measured_at: string
  created_at: string
}

export type AttendanceSummary = {
  total_records: number
  present: number
  absent: number
  late: number
  excused: number
  attendance_rate: number | null
}

export type OrgOverview = {
  student_count: number
  active_students: number
  sessions_this_month: number
  upcoming_events: number
  analyses_linked: number
  avg_attendance_rate: number | null
}

export type PerformanceSeriesPoint = {
  id: string | null
  measured_at: string
  metric_key: string
  metric_value: number
  unit: string | null
  source: "analysis" | "manual"
  source_analysis_id: string | null
}

// ── Students ─────────────────────────────────────────────────────────────────

export const listStudents = async (
  auth0Id: string,
  opts: { search?: string; sport?: string; status?: string } = {},
): Promise<Student[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const search = opts.search?.trim() ?? ""
      const rows = await db<Student[]>`
        select *
        from students
        where auth0_id = ${auth0Id}
          and (${search} = '' or full_name ilike ${`%${search}%`}
               or email ilike ${`%${search}%`} or sport ilike ${`%${search}%`})
          and (${opts.sport ?? ""} = '' or sport = ${opts.sport ?? null})
          and (${opts.status ?? ""} = '' or status = ${opts.status ?? null})
        order by full_name asc;
      `
      return rows ?? []
    })) ?? []
  )
}

export const getStudent = async (auth0Id: string, id: string): Promise<Student | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<Student[]>`
      select * from students where auth0_id = ${auth0Id} and id = ${id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

const studentInsertCols = {
  full_name: true,
  email: true,
  phone: true,
  sport: true,
  position: true,
  jersey_number: true,
  date_of_birth: true,
  gender: true,
  guardian_name: true,
  guardian_phone: true,
  notes: true,
  status: true,
  joined_on: true,
} as const

export type StudentInput = Record<string, unknown>

export const createStudent = async (
  auth0Id: string,
  input: StudentInput,
): Promise<Student | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const cols = Object.keys(studentInsertCols).filter(
      (k) => k in input && input[k] !== undefined && input[k] !== null && input[k] !== "",
    )
    const placeholders = ["$1", ...cols.map((_, i) => `$${i + 2}`)].join(", ")
    const sql = `
      insert into students (auth0_id, ${cols.join(", ")})
      values (${placeholders})
      returning *;
    `
    const values = cols.map((k) => input[k])
    const rows = await db.unsafe<Student[]>(sql, [auth0Id, ...values])
    return rows[0] ?? null
  })
}

export const updateStudent = async (
  auth0Id: string,
  id: string,
  input: StudentInput,
): Promise<Student | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const cols = Object.keys(studentInsertCols).filter((k) => k in input)
    const setClause =
      cols.map((k, i) => `${k} = $${i + 1}::text`).join(", ") +
      (cols.length ? ", " : "")
    const sql = `
      update students set
        ${setClause} updated_at = now()
      where auth0_id = $${cols.length + 1} and id = $${cols.length + 2}
      returning *;
    `
    const values = cols.map((k) => {
      const v = input[k]
      if (v === undefined || v === null) return null
      return typeof v === "number" ? v : String(v)
    })
    const rows = await db.unsafe<Student[]>(sql, [...values, auth0Id, id])
    return rows[0] ?? null
  })
}

export const deleteStudent = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from students where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

export const listStudentSports = async (auth0Id: string): Promise<string[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ sport: string | null }[]>`
        select distinct sport from students
        where auth0_id = ${auth0Id} and sport is not null
        order by sport asc;
      `
      return (rows ?? []).map((r) => r.sport as string)
    })) ?? []
  )
}

// ── Attendance ───────────────────────────────────────────────────────────────

export const listAttendance = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<AttendanceWithStudent[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<AttendanceWithStudent[]>`
        select a.*, s.full_name, s.sport
        from attendance a
        join students s on s.id = a.student_id
        where a.auth0_id = ${auth0Id}
          and (${opts.from ?? null}::date is null or a.session_date >= ${opts.from ?? null}::date)
          and (${opts.to ?? null}::date is null or a.session_date <= ${opts.to ?? null}::date)
          and (${opts.studentId ?? null}::uuid is null or a.student_id = ${opts.studentId ?? null}::uuid)
        order by a.session_date desc, s.full_name asc;
      `
      return rows ?? []
    })) ?? []
  )
}

export const getAttendance = async (
  auth0Id: string,
  studentId: string,
  sessionDate: string,
): Promise<AttendanceRecord | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<AttendanceRecord[]>`
      select * from attendance
      where auth0_id = ${auth0Id} and student_id = ${studentId} and session_date = ${sessionDate}::date
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const upsertAttendance = async (
  auth0Id: string,
  studentId: string,
  sessionDate: string,
  status: AttendanceStatus,
  note?: string | null,
): Promise<AttendanceRecord | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<AttendanceRecord[]>`
      insert into attendance (auth0_id, student_id, session_date, status, note)
      values (${auth0Id}, ${studentId}, ${sessionDate}::date, ${status}, ${note || null})
      on conflict (student_id, session_date) do update set
        status = excluded.status,
        note = excluded.note,
        updated_at = now()
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const setAttendanceBatch = async (
  auth0Id: string,
  entries: { studentId: string; sessionDate: string; status: AttendanceStatus; note?: string | null }[],
): Promise<AttendanceRecord[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const results: AttendanceRecord[] = []
      for (const entry of entries) {
        const rows = await db<AttendanceRecord[]>`
          insert into attendance (auth0_id, student_id, session_date, status, note)
          values (${auth0Id}, ${entry.studentId}, ${entry.sessionDate}::date, ${entry.status}, ${entry.note || null})
          on conflict (student_id, session_date) do update set
            status = excluded.status,
            note = excluded.note,
            updated_at = now()
          returning *;
        `
        if (rows?.[0]) results.push(rows[0])
      }
      return results
    })) ?? []
  )
}

export const deleteAttendance = async (
  auth0Id: string,
  studentId: string,
  sessionDate: string,
): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from attendance
      where auth0_id = ${auth0Id} and student_id = ${studentId} and session_date = ${sessionDate}::date
      returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

export const attendanceSummary = async (
  auth0Id: string,
  opts: { from?: string; to?: string; studentId?: string } = {},
): Promise<AttendanceSummary> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<AttendanceSummary[]>`
        select
          count(*)::int as total_records,
          count(*) filter (where status = 'present')::int as present,
          count(*) filter (where status = 'absent')::int as absent,
          count(*) filter (where status = 'late')::int as late,
          count(*) filter (where status = 'excused')::int as excused,
          case when count(*) = 0 then null
               else round((count(*) filter (where status in ('present', 'late')) * 100.0) / count(*), 1)
          end as attendance_rate
        from attendance
        where auth0_id = ${auth0Id}
          and (${opts.from ?? null}::date is null or session_date >= ${opts.from ?? null}::date)
          and (${opts.to ?? null}::date is null or session_date <= ${opts.to ?? null}::date)
          and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid);
      `
      return (
        rows?.[0] ?? {
          total_records: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          attendance_rate: null,
        }
      )
    })) ?? {
      total_records: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      attendance_rate: null,
    }
  )
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export const listSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string } = {},
): Promise<ScheduleEvent[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<ScheduleEvent[]>`
        select * from schedule_events
        where auth0_id = ${auth0Id}
          and (${opts.from ?? null}::timestamptz is null or starts_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or starts_at <= ${opts.to ?? null}::timestamptz)
        order by starts_at asc;
      `
      return rows ?? []
    })) ?? []
  )
}

const scheduleInsertCols = {
  title: true,
  event_type: true,
  starts_at: true,
  ends_at: true,
  location: true,
  description: true,
  status: true,
} as const

export type ScheduleInput = Record<string, unknown>

export const createScheduleEvent = async (
  auth0Id: string,
  input: ScheduleInput,
): Promise<ScheduleEvent | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const cols = Object.keys(scheduleInsertCols).filter(
      (k) => k in input && input[k] !== undefined && input[k] !== null && input[k] !== "",
    )
    const placeholders = ["$1", ...cols.map((_, i) => `$${i + 2}`)].join(", ")
    const sql = `
      insert into schedule_events (auth0_id, ${cols.join(", ")})
      values (${placeholders})
      returning *;
    `
    const rows = await db.unsafe<ScheduleEvent[]>(sql, [auth0Id, ...cols.map((k) => input[k])])
    return rows[0] ?? null
  })
}

export const updateScheduleEvent = async (
  auth0Id: string,
  id: string,
  input: ScheduleInput,
): Promise<ScheduleEvent | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const cols = Object.keys(scheduleInsertCols).filter((k) => k in input)
    const setClause =
      cols.map((k, i) => `${k} = $${i + 1}::text`).join(", ") +
      (cols.length ? ", " : "")
    const sql = `
      update schedule_events set
        ${setClause} updated_at = now()
      where auth0_id = $${cols.length + 1} and id = $${cols.length + 2}
      returning *;
    `
    const values = cols.map((k) => {
      const v = input[k]
      if (v === undefined || v === null) return null
      return String(v)
    })
    const rows = await db.unsafe<ScheduleEvent[]>(sql, [...values, auth0Id, id])
    return rows[0] ?? null
  })
}

export const deleteScheduleEvent = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from schedule_events where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

// ── Reports ──────────────────────────────────────────────────────────────────

export const getStudentAnalyses = async (
  auth0Id: string,
  studentId: string,
  limit = 50,
): Promise<DashboardAnalysis[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<DashboardAnalysis[]>`
        select
          a.server_job_id,
          a.engine_job_id,
          a.session_token,
          a.player_index,
          a.model,
          a.stage,
          a.stage_name,
          a.progress,
          a.complete,
          a.video_ready,
          a.summary_json,
          a.error_code,
          a.error_message,
          a.requested_at,
          a.completed_at,
          a.download_count,
          a.display_name,
          a.student_id,
          v.file_name,
          v.file_size_bytes,
          v.player_count
        from analysis_history a
        left join video_conversations v on a.session_token = v.session_token
        where a.auth0_id = ${auth0Id} and a.student_id = ${studentId}
        order by a.requested_at desc
        limit ${limit};
      `
      return rows ?? []
    })) ?? []
  )
}

export type ReportInput = {
  student_id?: string | null
  report_type: string
  title: string
  period_start?: string | null
  period_end?: string | null
  content_json: Record<string, unknown>
}

export const listReports = async (
  auth0Id: string,
  opts: { studentId?: string } = {},
): Promise<Array<ReportRecord & { full_name: string | null }>> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
        select r.*, s.full_name
        from reports r
        left join students s on s.id = r.student_id
        where r.auth0_id = ${auth0Id}
          and (${opts.studentId ?? null}::uuid is null or r.student_id = ${opts.studentId ?? null}::uuid)
        order by r.created_at desc;
      `
      return rows ?? []
    })) ?? []
  )
}

export const getReport = async (
  auth0Id: string,
  id: string,
): Promise<(ReportRecord & { full_name: string | null }) | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
      select r.*, s.full_name
      from reports r
      left join students s on s.id = r.student_id
      where r.auth0_id = ${auth0Id} and r.id = ${id}
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const createReportRecord = async (
  auth0Id: string,
  input: ReportInput,
): Promise<ReportRecord | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<ReportRecord[]>`
      insert into reports (
        auth0_id, student_id, report_type, title, period_start, period_end, content_json
      ) values (
        ${auth0Id},
        ${input.student_id ?? null}::uuid,
        ${input.report_type},
        ${input.title},
        ${input.period_start ?? null}::date,
        ${input.period_end ?? null}::date,
        ${JSON.stringify(input.content_json)}::jsonb
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const deleteReport = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from reports where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

export const listRecentAnalysisScores = async (
  auth0Id: string,
  limit = 20,
): Promise<DashboardAnalysis[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<DashboardAnalysis[]>`
        select
          a.server_job_id,
          a.engine_job_id,
          a.session_token,
          a.player_index,
          a.model,
          a.stage,
          a.stage_name,
          a.progress,
          a.complete,
          a.video_ready,
          a.summary_json,
          a.error_code,
          a.error_message,
          a.requested_at,
          a.completed_at,
          a.download_count,
          a.display_name,
          a.student_id,
          v.file_name,
          v.file_size_bytes,
          v.player_count
        from analysis_history a
        left join video_conversations v on a.session_token = v.session_token
        where a.auth0_id = ${auth0Id}
          and a.complete = true
          and a.summary_json is not null
          and (a.summary_json->>'form_score') is not null
        order by a.requested_at desc
        limit ${limit};
      `
      return rows ?? []
    })) ?? []
  )
}

function buildPeriodLabel(
  reportType: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const fmt = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  if (reportType === "monthly") {
    const anchor = from ? new Date(`${from.slice(0, 10)}T00:00:00`) : new Date()
    return `Month of ${anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`
  }
  if (from && to) return `from ${fmt(from)} to ${fmt(to)}`
  if (from) return `since ${fmt(from)}`
  if (to) return `through ${fmt(to)}`
  return "All time"
}

export const buildReportContent = async (
  auth0Id: string,
  opts: {
    student_id?: string | null
    from?: string | null
    to?: string | null
    report_type?: string | null
  } = {},
): Promise<Record<string, unknown>> => {
  const { student_id, from, to, report_type } = opts
  const [attendance, series, analyses] = await Promise.all([
    attendanceSummary(auth0Id, {
      from: from ?? undefined,
      to: to ?? undefined,
      studentId: student_id ?? undefined,
    }),
    student_id
      ? getStudentPerformanceSeries(auth0Id, student_id, { from: from ?? undefined, to: to ?? undefined })
      : Promise.resolve([]),
    student_id
      ? getStudentAnalyses(auth0Id, student_id, 20)
      : listRecentAnalysisScores(auth0Id, 20),
  ])

  const student = student_id ? await getStudent(auth0Id, student_id) : null

  const formScores = series.filter((s) => s.metric_key === "form_score")
  const formScoreAvg =
    formScores.length > 0
      ? Math.round((formScores.reduce((acc, s) => acc + s.metric_value, 0) / formScores.length) * 10) / 10
      : null
  const formScoreLatest = formScores.length > 0 ? formScores[formScores.length - 1].metric_value : null

  const orgBlock = student_id
    ? null
    : await (async () => {
        const o = await getOrgOverview(auth0Id)
        return {
          student_count: o.student_count,
          active_students: o.active_students,
          sessions_this_month: o.sessions_this_month,
          upcoming_events: o.upcoming_events,
          analyses_linked: o.analyses_linked,
          avg_attendance_rate: o.avg_attendance_rate,
        }
      })()

  const attendanceBlock = {
    total_records: attendance.total_records,
    present: attendance.present,
    absent: attendance.absent,
    late: attendance.late,
    excused: attendance.excused,
    attendance_rate: attendance.attendance_rate,
  }
  const performanceBlock = {
    form_score_avg: formScoreAvg,
    form_score_latest: formScoreLatest,
    total_sessions: formScores.length,
    latest_analysis_at: formScores.length > 0 ? formScores[formScores.length - 1].measured_at : null,
  }
  const analysesBlock = analyses.map((a) => ({
    server_job_id: a.server_job_id,
    requested_at: a.requested_at,
    display_name: a.display_name,
    student_id: a.student_id,
    form_score:
      typeof a.summary_json === "object" && a.summary_json && "form_score" in a.summary_json
        ? Number((a.summary_json as Record<string, unknown>).form_score)
        : null,
  }))

  let summary: string | null
  if (orgBlock) {
    const parts: string[] = []
    parts.push(`${orgBlock.student_count} student(s) on the roster (${orgBlock.active_students} active).`)
    if (orgBlock.avg_attendance_rate !== null) {
      parts.push(`Roster attendance over the last 30 days: ${orgBlock.avg_attendance_rate}%.`)
    }
    if (orgBlock.sessions_this_month > 0) parts.push(`${orgBlock.sessions_this_month} session(s) scheduled this month.`)
    if (orgBlock.analyses_linked > 0) parts.push(`${orgBlock.analyses_linked} analysis(ies) linked to students.`)
    if (performanceBlock.form_score_avg !== null) {
      parts.push(
        `Average form score across the ${performanceBlock.total_sessions} most recent analyzed session(s) is ${performanceBlock.form_score_avg}/10.`,
      )
    } else if (attendanceBlock.total_records > 0) {
      parts.push(
        `Attendance rate over the period was ${attendanceBlock.attendance_rate ?? 0}% across ${attendanceBlock.total_records} record(s).`,
      )
    }
    summary = parts.length ? parts.join(" ") : "No data is available yet for this academy."
  } else if (performanceBlock.form_score_avg !== null) {
    summary = `Average form score across ${performanceBlock.total_sessions} analyzed session(s) is ${performanceBlock.form_score_avg}/10${
      attendanceBlock.total_records > 0
        ? `; attendance rate over the period was ${attendanceBlock.attendance_rate ?? 0}%`
        : ""
    }.`
  } else if (attendanceBlock.total_records > 0) {
    summary = `Attendance rate over the period was ${attendanceBlock.attendance_rate ?? 0}% across ${attendanceBlock.total_records} record(s).`
  } else {
    summary = "No attendance or performance data is available for the selected period."
  }

  return {
    generated_at: new Date().toISOString(),
    student: student
      ? {
          id: student.id,
          full_name: student.full_name,
          sport: student.sport,
          position: student.position,
          status: student.status,
        }
      : null,
    period: { start: from ?? null, end: to ?? null, label: buildPeriodLabel(report_type, from, to) },
    attendance: attendanceBlock,
    performance: performanceBlock,
    analyses: analysesBlock,
    summary,
    org: orgBlock,
  }
}

export const updateReportRecord = async (
  auth0Id: string,
  id: string,
  input: {
    report_type: string
    title: string
    period_start: string | null
    period_end: string | null
    content_json: Record<string, unknown>
  },
): Promise<(ReportRecord & { full_name: string | null }) | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<Array<ReportRecord & { full_name: string | null }>>`
      update reports set
        report_type = ${input.report_type},
        title = ${input.title},
        period_start = ${input.period_start}::date,
        period_end = ${input.period_end}::date,
        content_json = ${JSON.stringify(input.content_json)}::jsonb,
        updated_at = now()
      where auth0_id = ${auth0Id} and id = ${id}
      returning *, (select full_name from students s where s.id = reports.student_id) as full_name;
    `
    return rows?.[0] ?? null
  })
}

// ── Performance ──────────────────────────────────────────────────────────────

export const listPerformance = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string; limit?: number } = {},
): Promise<PerformanceMetric[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<PerformanceMetric[]>`
        select id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value, unit,
               source_analysis_id, measured_at, created_at
        from performance_metrics
        where auth0_id = ${auth0Id} and student_id = ${studentId}
          and (${opts.metricKey ?? ""} = '' or metric_key = ${opts.metricKey ?? null})
          and (${opts.from ?? null}::timestamptz is null or measured_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or measured_at <= ${opts.to ?? null}::timestamptz)
        order by measured_at asc
        limit ${opts.limit ?? 500};
      `
      return rows ?? []
    })) ?? []
  )
}

export type PerformanceInput = {
  student_id: string
  metric_key: string
  metric_value: number
  unit?: string | null
  source_analysis_id?: string | null
  measured_at?: string | null
}

export const createPerformanceMetric = async (
  auth0Id: string,
  input: PerformanceInput,
): Promise<PerformanceMetric | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<PerformanceMetric[]>`
      insert into performance_metrics (
        auth0_id, student_id, metric_key, metric_value, unit, source_analysis_id, measured_at
      ) values (
        ${auth0Id},
        ${input.student_id}::uuid,
        ${input.metric_key},
        ${input.metric_value}::float8,
        ${input.unit ?? null},
        ${input.source_analysis_id ?? null},
        ${input.measured_at ?? null}::timestamptz
      )
      on conflict (student_id, metric_key, measured_at) do nothing
      returning id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value,
        unit, source_analysis_id, measured_at, created_at;
    `
    return rows?.[0] ?? null
  })
}

export const updatePerformanceMetric = async (
  auth0Id: string,
  id: string,
  input: { metric_value: number; unit?: string | null },
): Promise<PerformanceMetric | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<PerformanceMetric[]>`
      update performance_metrics set
        metric_value = ${input.metric_value}::float8,
        unit = ${input.unit ?? null}
      where auth0_id = ${auth0Id} and id = ${id}::uuid and source_analysis_id is null
      returning id, auth0_id, student_id, metric_key, metric_value::float8 as metric_value,
        unit, source_analysis_id, measured_at, created_at;
    `
    return rows?.[0] ?? null
  })
}

export const deletePerformanceMetric = async (auth0Id: string, id: string): Promise<boolean> => {
  const res = await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<{ id: string }[]>`
      delete from performance_metrics where auth0_id = ${auth0Id} and id = ${id} returning id;
    `
    return rows?.[0] ? true : false
  })
  return res ?? false
}

/**
 * Combined performance timeline for a student: manual metrics + form scores
 * extracted from completed AI analyses.
 */
export const getStudentPerformanceSeries = async (
  auth0Id: string,
  studentId: string,
  opts: { metricKey?: string; from?: string; to?: string } = {},
): Promise<PerformanceSeriesPoint[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const analyses = await db<
        { requested_at: string; form_score: number | null; server_job_id: string }[]
      >`
        select
          requested_at,
          (summary_json->>'form_score')::float8 as form_score,
          server_job_id
        from analysis_history
        where auth0_id = ${auth0Id}
          and student_id = ${studentId}::uuid
          and complete = true
          and summary_json is not null
          and (summary_json->>'form_score') is not null
          and (${opts.from ?? null}::timestamptz is null or requested_at >= ${opts.from ?? null}::timestamptz)
          and (${opts.to ?? null}::timestamptz is null or requested_at <= ${opts.to ?? null}::timestamptz)
        order by requested_at asc;
      `
      const manual = await listPerformance(auth0Id, studentId, {
        metricKey: opts.metricKey || undefined,
        from: opts.from,
        to: opts.to,
      })

      const points: PerformanceSeriesPoint[] = [
        ...(analyses ?? []).map((a) => ({
          id: null as string | null,
          measured_at: a.requested_at,
          metric_key: "form_score",
          metric_value: a.form_score as number,
          unit: "/10",
          source: "analysis" as const,
          source_analysis_id: a.server_job_id,
        })),
        ...(manual ?? []).map((m) => ({
          id: m.id,
          measured_at: m.measured_at,
          metric_key: m.metric_key,
          metric_value: m.metric_value,
          unit: m.unit,
          source: "manual" as const,
          source_analysis_id: m.source_analysis_id,
        })),
      ]

      points.sort((a, b) => a.measured_at.localeCompare(b.measured_at))
      return points
    })) ?? []
  )
}

// ── Org Overview ─────────────────────────────────────────────────────────────

export const getOrgOverview = async (auth0Id: string): Promise<OrgOverview> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<OrgOverview[]>`
        select
          (select count(*)::int from students where auth0_id = ${auth0Id}) as student_count,
          (select count(*)::int from students where auth0_id = ${auth0Id} and status = 'active') as active_students,
          (select count(*)::int from schedule_events
             where auth0_id = ${auth0Id}
               and date_trunc('month', starts_at) = date_trunc('month', now())) as sessions_this_month,
          (select count(*)::int from schedule_events
             where auth0_id = ${auth0Id} and status = 'scheduled' and starts_at > now()) as upcoming_events,
          (select count(*)::int from analysis_history
             where auth0_id = ${auth0Id} and student_id is not null) as analyses_linked,
          (
            select case when count(*) = 0 then null
                 else round((count(*) filter (where status in ('present', 'late')) * 100.0) / count(*), 1)
            end
            from attendance
            where auth0_id = ${auth0Id}
              and session_date >= current_date - interval '30 days'
          ) as avg_attendance_rate;
      `
      return (
        rows?.[0] ?? {
          student_count: 0,
          active_students: 0,
          sessions_this_month: 0,
          upcoming_events: 0,
          analyses_linked: 0,
          avg_attendance_rate: null,
        }
      )
    })) ?? {
      student_count: 0,
      active_students: 0,
      sessions_this_month: 0,
      upcoming_events: 0,
      analyses_linked: 0,
      avg_attendance_rate: null,
    }
  )
}