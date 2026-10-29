// ── Org analysis queries ─────────────────────────────────────────────────────
// Analysis rows scoped to one student or to the latest scored sessions, used
// by report assembly and the player hub. Kept out of orgReports so report
// content can depend on them without a module cycle.
import { withHistoryStoreOrThrow as withHistoryStore } from './orgStore'
import { ANALYSES_SELECT_COLUMNS } from './analyses'
import type { DashboardAnalysis } from './analyses'

export const getStudentAnalyses = async (
  auth0Id: string,
  studentId: string,
  limit = 200,
): Promise<DashboardAnalysis[]> => {
  return (
    (await withHistoryStore(async (db) => {
      const rows = await db<DashboardAnalysis[]>`
        select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
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

export const listRecentAnalysisScores = async (
  auth0Id: string,
  limit = 20,
): Promise<DashboardAnalysis[]> => {
  return (
    (await withHistoryStore(async (db) => {
      const rows = await db<DashboardAnalysis[]>`
        select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
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
