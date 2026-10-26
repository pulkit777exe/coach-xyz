'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  LinkIcon,
  UnlinkIcon,
  MailIcon,
  PhoneIcon,
  CalendarIcon,
  FileTextIcon,
} from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/9ui/ui/avatar'
import { Skeleton } from '@/components/9ui/ui/skeleton'
import dynamic from 'next/dynamic'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/9ui/ui/dropdown-menu'
import type { ChartConfig } from '@/components/9ui/ui/chart'
import { Spinner } from './Spinner'
import StudentFormDialog from './StudentFormDialog'
import ObjectivesSection from './ObjectivesSection'
import PlansSection from './PlansSection'
import WellnessSection from './WellnessSection'

import type {
  Student,
  PerformanceSeriesPoint,
  AttendanceSummary,
  ReportRecord,
  MetricTrend,
  ComparisonStudent,
} from '@/lib/org'
import type { DashboardAnalysis } from '@/lib/library'
import type { CoachAIError } from '@/lib/data/errors'
import {
  orgStudentPerformance,
  orgAddPerformanceMetric,
  orgDeletePerformanceMetric,
  orgUpdatePerformanceMetric,
  orgDeleteStudent,
  orgDeleteReport,
  linkAnalysisToStudent,
  orgAttendanceSummary,
  orgStudents,
  orgStudentTrends,
  orgCompareStudents,
} from '@/lib/org'
import { formatDateLong, formatDateMed, formatDateShort } from '@/lib/date'
import { analysisScore } from '@/lib/analysis'
import { ATTENDANCE_STATUS_LABELS } from '@/lib/org'
import { capitalize } from '@/lib/utils'
import { initials } from '@/lib/initials'

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success/15 text-success',
  inactive: 'bg-warning/15 text-warning',
  transferred: 'bg-muted text-muted-foreground',
}

const PerformanceChart = dynamic(() => import('./PerformanceChart'), {
  ssr: false,
  // Aspect box while the chart chunk lands — sized by the Skeleton.
  loading: () => <Skeleton className="aspect-[16/7] w-full rounded-[6px]" />,
})

const METRIC_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

export default function StudentProfile({
  auth0Id,
  student,
  initialSeries,
  initialAttendance,
  initialReports,
  allAnalyses,
  sports,
  canWrite,
}: {
  auth0Id: string
  student: Student
  initialSeries: PerformanceSeriesPoint[]
  initialAttendance: AttendanceSummary | null
  initialReports: ReportRecord[]
  allAnalyses: DashboardAnalysis[]
  sports: string[]
  /** Student-domain writes (edit/remove, metrics, links, objectives/plans) — player.manage. */
  canWrite: boolean
}) {
  const router = useRouter()
  const [student_, setStudent] = useState<Student>(student)
  const [series, setSeries] = useState<PerformanceSeriesPoint[]>(initialSeries)
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(initialAttendance)
  const [reports, setReports] = useState<ReportRecord[]>(initialReports)
  const [analyses, setAnalyses] = useState<DashboardAnalysis[]>(allAnalyses)
  const [editOpen, setEditOpen] = useState(false)
  const [editTeams, setEditTeams] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!editOpen) return
    let cancelled = false
    void import('@/lib/teams').then(({ listTeams }) =>
      listTeams(auth0Id)
        .then((res) => {
          if (!cancelled) setEditTeams(res.teams)
        })
        .catch(() => {
          if (!cancelled) setEditTeams([])
        }),
    )
    return () => {
      cancelled = true
    }
  }, [editOpen, auth0Id])
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    action: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const [selectedKey, setSelectedKey] = useState<string>('all')
  const [isMetricSubmitting, setMetricSubmitting] = useState(false)
  const [editingMetric, setEditingMetric] = useState<PerformanceSeriesPoint | null>(null)
  const [metricForm, setMetricForm] = useState({
    metric_key: '',
    metric_value: '',
    unit: '',
    measured_at: '',
  })

  const [trends, setTrends] = useState<MetricTrend[]>([])
  const [roster, setRoster] = useState<Student[]>([])
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareMetric, setCompareMetric] = useState('form_score')
  const [comparison, setComparison] = useState<ComparisonStudent[]>([])
  const [compareBusy, setCompareBusy] = useState(false)

  // Client-side fetches for the trends + comparison sections. Both are
  // low-priority extras on top of the RSC streamed data, so failures fall
  // back to empty state rather than blocking the profile.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      orgStudentTrends(auth0Id, student_.id).catch(() => ({ trends: [] })),
      orgStudents(auth0Id).catch(() => ({ students: [] })),
    ]).then(([trendsRes, rosterRes]) => {
      if (cancelled) return
      setTrends(trendsRes.trends)
      setRoster(rosterRes.students.filter((s) => s.id !== student_.id))
    })
    return () => {
      cancelled = true
    }
  }, [auth0Id, student_.id])

  const keys = useMemo(() => [...new Set(series.map((s) => s.metric_key))].sort(), [series])

  const chartData = useMemo(() => {
    const includeAll = selectedKey === 'all'
    const rows: Record<string, string | number>[] = []
    const byDate = new Map<string, Record<string, string | number>>()
    for (const s of series) {
      if (!includeAll && s.metric_key !== selectedKey) continue
      const date = s.measured_at.slice(0, 10)
      let row = byDate.get(date)
      if (!row) {
        row = { date }
        byDate.set(date, row)
        rows.push(row)
      }
      row[s.metric_key] = s.metric_value
    }
    return rows
  }, [series, selectedKey])

  const shownKeys = useMemo(
    () => (selectedKey === 'all' ? keys : [selectedKey]),
    [selectedKey, keys],
  )

  const manualPoints = useMemo(
    () =>
      series
        .filter((s) => s.source === 'manual')
        .slice()
        .sort((a, b) => b.measured_at.localeCompare(a.measured_at)),
    [series],
  )

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {}
    for (const s of series) {
      if (!config[s.metric_key]) {
        config[s.metric_key] = {
          label: formatKey(s.metric_key),
          color: METRIC_COLORS[Object.keys(config).length % METRIC_COLORS.length],
        }
      }
    }
    return config
  }, [series])

  const compareMetricOptions = useMemo(() => {
    const opts = new Set<string>(keys)
    opts.add('form_score')
    return [...opts].sort()
  }, [keys])

  const comparisonData = useMemo(() => {
    const rows: Record<string, string | number>[] = []
    const byDate = new Map<string, Record<string, string | number>>()
    for (const c of comparison) {
      for (const p of c.points) {
        const date = p.measured_at.slice(0, 10)
        let row = byDate.get(date)
        if (!row) {
          row = { date }
          byDate.set(date, row)
          rows.push(row)
        }
        row[c.full_name] = p.metric_value
      }
    }
    return rows
  }, [comparison])

  const comparisonKeys = useMemo(() => comparison.map((c) => c.full_name), [comparison])

  const comparisonConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {}
    comparison.forEach((c, i) => {
      config[c.full_name] = {
        label: c.full_name,
        color: METRIC_COLORS[i % METRIC_COLORS.length],
      }
    })
    return config
  }, [comparison])

  const linked = analyses.filter((a) => a.student_id === student_.id)
  const unlinked = analyses.filter((a) => !a.student_id)

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 9) return prev
      return [...prev, id]
    })
  }

  const loadComparison = async () => {
    if (!compareIds.length) {
      setComparison([])
      return
    }
    setCompareBusy(true)
    try {
      const res = await orgCompareStudents(auth0Id, [student_.id, ...compareIds], compareMetric)
      setComparison(res.comparison)
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to load comparison')
    } finally {
      setCompareBusy(false)
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    setConfirmBusy(true)
    try {
      await confirm.action()
      setConfirm(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const addMouseMetric = async () => {
    const raw = Number(metricForm.metric_value)
    if (!Number.isFinite(raw)) {
      toast.error('Enter a numeric metric value')
      return
    }
    const payload: {
      metric_key: string
      metric_value: number
      unit?: string | null
      measured_at?: string
    } = {
      metric_key: metricForm.metric_key.trim() || 'form_score',
      metric_value: raw,
    }
    if (metricForm.unit.trim()) payload.unit = metricForm.unit.trim()
    else payload.unit = null
    if (metricForm.measured_at) payload.measured_at = metricForm.measured_at

    setMetricSubmitting(true)
    try {
      if (editingMetric) {
        const id = editingMetric.id
        if (!id) return
        await orgUpdatePerformanceMetric(auth0Id, id, {
          metric_value: payload.metric_value,
          unit: payload.unit ?? null,
        })
      } else {
        await orgAddPerformanceMetric(auth0Id, student_.id, payload)
      }
      toast.success(editingMetric ? 'Metric updated' : 'Metric logged')
      setEditingMetric(null)
      setMetricForm({ metric_key: '', metric_value: '', unit: '', measured_at: '' })
      await refresh()
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to log metric')
    } finally {
      setMetricSubmitting(false)
    }
  }

  const openMetricEdit = (p: PerformanceSeriesPoint) => {
    setEditingMetric(p)
    setMetricForm({
      metric_key: p.metric_key,
      metric_value: String(p.metric_value),
      unit: p.unit ?? '',
      measured_at: p.measured_at.slice(0, 10),
    })
  }

  const setAnalysisLink = async (analysis: DashboardAnalysis, studentId: string | null) => {
    try {
      const res = await linkAnalysisToStudent(auth0Id, analysis.server_job_id, studentId)
      toast.success(studentId ? 'Analysis linked' : 'Analysis unlinked')
      const updated: DashboardAnalysis = {
        ...analysis,
        student_id: res.analysis.student_id ?? null,
      }
      setAnalyses((prev) =>
        prev.map((a) => (a.server_job_id === updated.server_job_id ? updated : a)),
      )
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to update link')
    }
  }

  const refresh = async () => {
    const [seriesRes, attRes] = await Promise.all([
      orgStudentPerformance(auth0Id, student_.id),
      orgAttendanceSummary(auth0Id, { studentId: student_.id }),
    ])
    setSeries(seriesRes.series)
    setAttendance(attRes.summary)
  }

  const attStats = [
    {
      label: ATTENDANCE_STATUS_LABELS.present,
      value: attendance === null ? '\u2014' : (attendance.present ?? '\u2014'),
      color: 'var(--color-success)',
    },
    {
      label: ATTENDANCE_STATUS_LABELS.late,
      value: attendance === null ? '\u2014' : (attendance.late ?? '\u2014'),
      color: 'var(--color-warning)',
    },
    {
      label: ATTENDANCE_STATUS_LABELS.absent,
      value: attendance === null ? '\u2014' : (attendance.absent ?? '\u2014'),
      color: 'var(--color-destructive)',
    },
    {
      label: ATTENDANCE_STATUS_LABELS.excused,
      value: attendance === null ? '\u2014' : (attendance.excused ?? '\u2014'),
      color: 'var(--color-info)',
    },
  ]

  return (
    <div>
      {/* Header */}
      <div className="border-border bg-card flex flex-col gap-5 rounded-[6px] border p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="border-border size-16 border">
            <AvatarImage src={undefined} alt="" />
            <AvatarFallback className="bg-muted text-muted-foreground font-semibold text-lg">
              {initials(student_.full_name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-foreground">
                {student_.full_name}
              </h2>
              <span
                className={`inline-flex h-[20px] items-center rounded-full px-2 font-medium leading-none text-label ${STATUS_STYLE[student_.status] ?? 'bg-muted text-muted-foreground'}`}
              >
                {student_.status}
              </span>
            </div>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body">
              {student_.sport && <span>{student_.sport}</span>}
              {student_.position && <span>{student_.position}</span>}
              {/* Ternary: jersey 0 is falsy, so the old `{… && …}` rendered a
                  bare `0` with no `#` and no chip span beside the other
                  metadata. The form input is type="number" with no min. */}
              {student_.jersey_number === null || student_.jersey_number === undefined ? null : (
                <span>#{student_.jersey_number}</span>
              )}
              {student_.gender && <span className="capitalize">{student_.gender}</span>}
            </div>
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta">
              {student_.email && (
                <span className="flex items-center gap-1.5">
                  <MailIcon className="size-3" /> {student_.email}
                </span>
              )}
              {student_.phone && (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="size-3" /> {student_.phone}
                </span>
              )}
              {student_.joined_on && (
                <span className="flex items-center gap-1.5">
                  <CalendarIcon className="size-3" /> Joined {formatDateLong(student_.joined_on)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canWrite && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <PencilIcon />
              Edit
            </Button>
          )}
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() =>
                setConfirm({
                  title: `Remove ${student_.full_name}?`,
                  description:
                    'This will permanently delete the student and their attendance records. Past reports keep a snapshot. This cannot be undone.',
                  action: async () => {
                    await orgDeleteStudent(auth0Id, student_.id)
                    toast.success(`${student_.full_name} removed`)
                    router.push('/dashboard/students')
                  },
                })
              }
            >
              <TrashIcon />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Profile details */}
      <div className="mt-8">
        <p className="mb-3 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Profile Details
        </p>
        <div className="border-border bg-card grid gap-px rounded-[6px] border sm:grid-cols-2">
          <DetailRow
            label="Date of birth"
            value={student_.date_of_birth ? formatDateLong(student_.date_of_birth) : '—'}
          />
          <DetailRow label="Gender" value={student_.gender ? capitalize(student_.gender) : '—'} />
          <DetailRow label="Guardian" value={student_.guardian_name || '—'} />
          <DetailRow label="Guardian phone" value={student_.guardian_phone || '—'} />
          <div className="border-border border-t p-4 sm:col-span-2">
            <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Notes
            </p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap text-body">
              {student_.notes || 'No notes recorded.'}
            </p>
          </div>
        </div>
      </div>

      {/* Attendance summary */}
      <div className="mt-8">
        <p className="mb-3 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Attendance Overview
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {attStats.map((s) => (
            <div key={s.label} className="rounded-[6px] border border-border bg-card p-5">
              <p className="flex items-center gap-1.5 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <span
                  className="inline-block size-1.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                {s.label}
              </p>
              <p className="mt-1.5 text-[28px] font-semibold leading-[1.1] tabular-nums text-foreground">
                {s.value}
              </p>
            </div>
          ))}
          <div className="rounded-[6px] border border-border bg-card p-5">
            <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Attendance Rate
            </p>
            <p className="mt-1.5 text-[28px] font-semibold leading-[1.1] tabular-nums text-foreground">
              {attendance === null ||
              attendance.attendance_rate === null ||
              attendance.attendance_rate === undefined
                ? '\u2014'
                : `${attendance.attendance_rate}%`}
            </p>
          </div>
        </div>
      </div>

      {/* Performance chart */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Performance Trend
          </p>
          {keys.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <MetricPill active={selectedKey === 'all'} onClick={() => setSelectedKey('all')}>
                All
              </MetricPill>
              {keys.map((k) => (
                <MetricPill key={k} active={selectedKey === k} onClick={() => setSelectedKey(k)}>
                  {formatKey(k)}
                </MetricPill>
              ))}
            </div>
          )}
        </div>

        <div className="border-border bg-card rounded-[6px] border p-4">
          {chartData.length ? (
            <PerformanceChart data={chartData} config={chartConfig} keys={shownKeys} />
          ) : (
            <div className="flex h-40 items-center justify-center">
              <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                No performance metrics yet — log one below
              </p>
            </div>
          )}
        </div>

        {/* Training objectives + finding trends (§26 loop) */}
        <div className="mt-8">
          <ObjectivesSection auth0Id={auth0Id} studentId={student_.id} canWrite={canWrite} />
        </div>

        {/* Training plans */}
        <div className="mt-8">
          <PlansSection auth0Id={auth0Id} studentId={student_.id} canWrite={canWrite} />
        </div>

        {/* Wellness check-ins (health data, medical-gated) */}
        <div className="mt-8">
          <WellnessSection auth0Id={auth0Id} studentId={student_.id} canWrite={canWrite} />
        </div>

        {/* Log metric — form only for player.manage; the logged list stays readable */}
        {(canWrite || manualPoints.length > 0) && (
          <div className="border-border bg-card mt-4 rounded-[6px] border p-4">
            {canWrite && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="metric_key" className="text-body font-medium">
                    Metric
                  </Label>
                  <Input
                    id="metric_key"
                    className="h-8 w-40 text-body leading-5"
                    placeholder="form_score"
                    disabled={Boolean(editingMetric)}
                    value={metricForm.metric_key}
                    onChange={(e) => setMetricForm((f) => ({ ...f, metric_key: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="metric_value" className="text-body font-medium">
                    Value *
                  </Label>
                  <Input
                    id="metric_value"
                    type="number"
                    step="any"
                    className="h-8 w-24 text-body leading-5"
                    value={metricForm.metric_value}
                    onChange={(e) => setMetricForm((f) => ({ ...f, metric_value: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="metric_unit" className="text-body font-medium">
                    Unit
                  </Label>
                  <Input
                    id="metric_unit"
                    className="h-8 w-24 text-body leading-5"
                    placeholder="pts"
                    value={metricForm.unit}
                    onChange={(e) => setMetricForm((f) => ({ ...f, unit: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="metric_at" className="text-body font-medium">
                    Date
                  </Label>
                  <Input
                    id="metric_at"
                    type="date"
                    className="h-8 w-36 text-body leading-5"
                    disabled={Boolean(editingMetric)}
                    value={metricForm.measured_at}
                    onChange={(e) => setMetricForm((f) => ({ ...f, measured_at: e.target.value }))}
                  />
                </div>
                <Button size="sm" onClick={addMouseMetric} disabled={isMetricSubmitting}>
                  {isMetricSubmitting ? <Spinner /> : editingMetric ? <PencilIcon /> : <PlusIcon />}{' '}
                  {editingMetric ? 'Update metric' : 'Log metric'}
                </Button>
                {editingMetric && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingMetric(null)
                      setMetricForm({ metric_key: '', metric_value: '', unit: '', measured_at: '' })
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}

            {manualPoints.length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-border pt-3">
                {manualPoints.map((p) => (
                  <li
                    key={p.id ?? `${p.metric_key}-${p.measured_at}`}
                    className="flex items-center justify-between gap-2 py-1 text-body leading-5"
                  >
                    <span className="text-foreground">
                      {formatKey(p.metric_key)}{' '}
                      <span className="text-muted-foreground">
                        {p.metric_value}
                        {p.unit ? ` ${p.unit}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground text-caption leading-4">
                        {formatDateShort(p.measured_at)}
                      </span>
                      {p.id && canWrite && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground"
                          onClick={() => openMetricEdit(p)}
                          aria-label="Edit metric"
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                      )}
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            p.id &&
                            setConfirm({
                              title: 'Delete this metric?',
                              description: `${formatKey(p.metric_key)} · ${p.metric_value}${p.unit ? ` ${p.unit}` : ''} on ${formatDateShort(p.measured_at)}.`,
                              action: async () => {
                                await orgDeletePerformanceMetric(auth0Id, p.id as string)
                                toast.success('Metric deleted')
                                await refresh()
                              },
                            })
                          }
                          aria-label="Delete metric"
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Trends summary */}
      <div className="mt-8">
        <p className="mb-3 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Performance Trends
        </p>
        {trends.length === 0 ? (
          <div className="border-border bg-card flex h-20 items-center justify-center rounded-[6px] border">
            <p className="text-muted-foreground text-caption leading-4">
              No trend data yet — metrics appear as they are logged or analyzed.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trends.map((t) => (
              <div key={t.metric_key} className="rounded-[6px] border border-border bg-card p-5">
                <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {formatKey(t.metric_key)}
                </p>
                <p className="text-foreground mt-1.5 text-[28px] font-semibold leading-[1.1] tabular-nums">
                  {t.latest ?? '—'}
                  {t.points[0]?.unit ? (
                    <span className="text-muted-foreground text-meta font-normal">
                      {' '}
                      {t.points[0].unit}
                    </span>
                  ) : null}
                </p>
                <div className="text-muted-foreground mt-1.5 flex items-center gap-3 text-meta">
                  <span className="tabular-nums">avg {t.avg ?? '—'}</span>
                  <TrendDelta change={t.change} />
                </div>
                <p className="text-muted-foreground mt-1 text-meta tabular-nums">
                  {t.points.length} point(s)
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compare with teammates */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Compare with Teammates
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={compareMetric}
              onValueChange={(v) => setCompareMetric(typeof v === 'string' ? v : 'form_score')}
            >
              <SelectTrigger className="h-8 w-auto" data-size="sm" aria-label="Metric to compare">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {compareMetricOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatKey(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={loadComparison}
              disabled={compareBusy || compareIds.length === 0}
            >
              {compareBusy ? <Spinner /> : null} Compare
            </Button>
          </div>
        </div>

        <div className="border-border bg-card rounded-[6px] border p-4">
          {roster.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-body leading-5">
              No other students on the roster to compare against yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {roster.map((s) => {
                const selected = compareIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleCompare(s.id)}
                    className={`rounded-[6px] border border-border px-2.5 py-1 text-meta transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selected
                        ? 'border-transparent bg-accent text-foreground'
                        : 'text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {s.full_name}
                    {selected ? ' ✓' : ''}
                  </button>
                )
              })}
            </div>
          )}

          {compareIds.length >= 9 ? (
            <p className="text-muted-foreground mt-2 text-caption leading-4">
              Limit of 9 teammates per comparison.
            </p>
          ) : null}

          {comparisonData.length > 0 ? (
            <div className="mt-4">
              <PerformanceChart
                data={comparisonData}
                config={comparisonConfig}
                keys={comparisonKeys}
              />
            </div>
          ) : compareIds.length > 0 ? (
            <p className="text-muted-foreground py-6 text-center text-body leading-5">
              No {formatKey(compareMetric)} data for the selected students yet.
            </p>
          ) : null}
        </div>
      </div>

      {/* Linked analyses */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Linked Analyses
          </p>
          {unlinked.length > 0 && canWrite && (
            <LinkAnalysisSelect
              unlinked={unlinked}
              onPick={(a) => setAnalysisLink(a, student_.id)}
            />
          )}
        </div>

        {linked.length === 0 ? (
          <div className="border-border bg-card flex flex-col items-center gap-2 rounded-[6px] border p-10 text-center">
            <p className="text-muted-foreground text-body leading-5">
              No analyses linked to {student_.full_name}.
            </p>
            <p className="text-caption leading-4 text-muted-foreground">
              {unlinked.length
                ? "Choose an analysis above to build this player's profile."
                : 'Run a video analysis first, then link it here.'}
            </p>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-[6px] border">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Analysis
                  </th>
                  <th className="px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Date
                  </th>
                  <th className="hidden px-4 py-2.5 text-left text-label font-medium uppercase tracking-[0.08em] text-muted-foreground md:table-cell">
                    Form
                  </th>
                  <th className="px-4 py-2.5 text-right text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {linked.map((a) => (
                  <tr
                    key={a.server_job_id}
                    className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-accent/50"
                  >
                    <td className="px-4 py-2.5 text-body">
                      <Link
                        href={`/dashboard/analysis/${a.server_job_id}`}
                        className="hover:underline"
                      >
                        {a.display_name || a.file_name || 'Untitled video'}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-body text-muted-foreground">
                      {formatDateMed(a.requested_at)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-body tabular-nums md:table-cell">
                      {analysisScore(a) ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setAnalysisLink(a, null)}
                        >
                          <UnlinkIcon className="size-3.5" /> Unlink
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reports */}
      <div className="mt-8">
        <p className="mb-3 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Reports
        </p>
        {reports.length === 0 ? (
          <div className="border-border bg-card flex flex-col items-center gap-2 rounded-[6px] border p-10 text-center">
            <FileTextIcon className="text-muted-foreground size-6" />
            <p className="text-muted-foreground text-body leading-5">
              No reports generated for {student_.full_name} yet.
            </p>
            <Link
              href="/dashboard/reports"
              className="text-foreground text-caption leading-4 underline"
            >
              Go to Reports
            </Link>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-[6px] border">
            <ul>
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="hover:bg-accent/50 border-b border-border flex items-center justify-between gap-3 px-4 py-2.5 text-body transition-colors duration-150 last:border-b-0"
                >
                  <Link
                    href={`/dashboard/reports/${r.id}`}
                    className="text-foreground hover:underline"
                  >
                    {r.title}
                  </Link>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground text-caption leading-4">
                      {formatDateMed(r.created_at)}
                    </span>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setConfirm({
                            title: 'Delete this report?',
                            description:
                              'This permanently removes the generated report. This cannot be undone.',
                            action: async () => {
                              await orgDeleteReport(auth0Id, r.id)
                              setReports((prev) => prev.filter((x) => x.id !== r.id))
                              toast.success('Report deleted')
                            },
                          })
                        }
                        aria-label="Delete report"
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <StudentFormDialog
        key={student_.id}
        auth0Id={auth0Id}
        open={editOpen}
        onOpenChange={setEditOpen}
        student={student_}
        sports={sports}
        teams={editTeams}
        onUpdated={(s) => {
          setStudent(s)
          refresh()
        }}
        onCreated={() => undefined}
      />

      {/* Destructive confirm */}
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runConfirm} disabled={confirmBusy}>
              {confirmBusy ? <Spinner /> : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border border-t p-4 first:border-t-0 sm:[&:nth-child(2)]:border-t-0">
      <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="text-foreground mt-1 text-body">{value}</p>
    </div>
  )
}

function MetricPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[6px] border border-border px-2.5 py-1 text-label font-medium uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
        active
          ? 'border-transparent bg-accent text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function TrendDelta({ change }: { change: number | null }) {
  if (change === null) return <span>no trend</span>
  if (change === 0) return <span>flat</span>
  const isUp = change > 0
  return (
    <span style={{ color: isUp ? 'var(--color-success)' : 'var(--color-destructive)' }}>
      {isUp ? '▲ +' : '▼ '}
      {Math.abs(change)}
    </span>
  )
}

function LinkAnalysisSelect({
  unlinked,
  onPick,
}: {
  unlinked: DashboardAnalysis[]
  onPick: (a: DashboardAnalysis) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <LinkIcon className="size-3.5" /> Link analysis
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {unlinked.map((a) => (
          <DropdownMenuItem key={a.server_job_id} onClick={() => onPick(a)}>
            <span className="max-w-56 truncate">
              {a.display_name || a.file_name || 'Untitled video'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatKey(key: string) {
  return key
    .split('_')
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ')
}
