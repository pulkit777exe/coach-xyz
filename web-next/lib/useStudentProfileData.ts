// ── Student profile data ─────────────────────────────────────────────────────
// One home for StudentProfile's server-data states + loaders: the trends +
// roster fan-out effect, the series/attendance refresh pair, comparison
// loading, metric save, analysis link/unlink, and report deletion. Dialogs,
// forms, selection, and chart memos stay in the component; toasts stay at
// the call sites (they are UI feedback, not data).

import { useCallback, useEffect, useState } from 'react'

import type { DashboardAnalysis } from './library'
import {
  linkAnalysisToStudent,
  orgAddPerformanceMetric,
  orgAttendanceSummary,
  orgCompareStudents,
  orgDeleteReport,
  orgStudentPerformance,
  orgStudentTrends,
  orgStudents,
  orgUpdatePerformanceMetric,
  type AttendanceSummary,
  type ComparisonStudent,
  type MetricTrend,
  type PerformanceSeriesPoint,
  type ReportRecord,
  type Student,
} from './org'

export type MetricInput = {
  metric_key: string
  metric_value: number
  unit?: string | null
  measured_at?: string
}

/** Split analyses into student-linked vs unlinked (pure, tested). */
export const partitionAnalyses = (
  analyses: DashboardAnalysis[],
  studentId: string,
): { linked: DashboardAnalysis[]; unlinked: DashboardAnalysis[] } => ({
  linked: analyses.filter((a) => a.student_id === studentId),
  unlinked: analyses.filter((a) => !a.student_id),
})

export function useStudentProfileData(opts: {
  auth0Id: string
  studentId: string
  initialSeries: PerformanceSeriesPoint[]
  initialAttendance: AttendanceSummary | null
  initialReports: ReportRecord[]
  initialAnalyses: DashboardAnalysis[]
}) {
  const { auth0Id, studentId } = opts
  const [series, setSeries] = useState<PerformanceSeriesPoint[]>(opts.initialSeries)
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(opts.initialAttendance)
  const [reports, setReports] = useState<ReportRecord[]>(opts.initialReports)
  const [analyses, setAnalyses] = useState<DashboardAnalysis[]>(opts.initialAnalyses)
  const [trends, setTrends] = useState<MetricTrend[]>([])
  const [roster, setRoster] = useState<Student[]>([])
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<ComparisonStudent[]>([])
  const [compareBusy, setCompareBusy] = useState(false)

  // Low-priority extras on top of the RSC streamed data — failures fall
  // back to empty state rather than blocking the profile.
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      orgStudentTrends(auth0Id, studentId).catch(() => ({ trends: [] })),
      orgStudents(auth0Id).catch(() => ({ students: [] })),
    ]).then(([trendsRes, rosterRes]) => {
      if (cancelled) return
      setTrends(trendsRes.trends)
      setRoster(rosterRes.students.filter((s) => s.id !== studentId))
    })
    return () => {
      cancelled = true
    }
  }, [auth0Id, studentId])

  const refresh = useCallback(async (): Promise<void> => {
    const [seriesRes, attRes] = await Promise.all([
      orgStudentPerformance(auth0Id, studentId),
      orgAttendanceSummary(auth0Id, { studentId }),
    ])
    setSeries(seriesRes.series)
    setAttendance(attRes.summary)
  }, [auth0Id, studentId])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 9) return prev
      return [...prev, id]
    })
  }, [])

  const loadComparison = useCallback(
    async (metric: string): Promise<void> => {
      if (!compareIds.length) {
        setComparison([])
        return
      }
      setCompareBusy(true)
      try {
        const res = await orgCompareStudents(auth0Id, [studentId, ...compareIds], metric)
        setComparison(res.comparison)
      } finally {
        setCompareBusy(false)
      }
    },
    [auth0Id, studentId, compareIds],
  )

  /** Add (or update by id) a manual metric, then refresh. Throws with message. */
  const saveMetric = useCallback(
    async (input: MetricInput, editingId: string | null): Promise<void> => {
      if (editingId) {
        await orgUpdatePerformanceMetric(auth0Id, editingId, {
          metric_value: input.metric_value,
          unit: input.unit ?? null,
        })
      } else {
        await orgAddPerformanceMetric(auth0Id, studentId, input)
      }
      await refresh()
    },
    [auth0Id, studentId, refresh],
  )

  /** Link/unlink an analysis, patching local state. Throws with message. */
  const setAnalysisLink = useCallback(
    async (analysis: DashboardAnalysis, targetStudentId: string | null): Promise<void> => {
      const res = await linkAnalysisToStudent(auth0Id, analysis.server_job_id, targetStudentId)
      const updated: DashboardAnalysis = {
        ...analysis,
        student_id: res.analysis.student_id ?? null,
      }
      setAnalyses((prev) =>
        prev.map((a) => (a.server_job_id === updated.server_job_id ? updated : a)),
      )
    },
    [auth0Id],
  )

  /** Delete a report, filtering local state. Throws with message. */
  const deleteReport = useCallback(
    async (id: string): Promise<void> => {
      await orgDeleteReport(auth0Id, id)
      setReports((prev) => prev.filter((x) => x.id !== id))
    },
    [auth0Id],
  )

  return {
    series,
    attendance,
    reports,
    analyses,
    trends,
    roster,
    compareIds,
    comparison,
    compareBusy,
    refresh,
    toggleCompare,
    loadComparison,
    saveMetric,
    setAnalysisLink,
    deleteReport,
  }
}
