'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarIcon,
  TrendingUpIcon,
  ClipboardListIcon,
  ActivityIcon,
  SparklesIcon,
  VideoIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Spinner } from '@/components/org/Spinner'
import { Button } from '@/components/9ui/ui/button'
import type { CoachAIError } from '@/lib/api'
import { getJobStatus } from '@/lib/api'
import { meStartAnalysis } from '@/lib/playerUpload'
import { useScanFlow } from '@/lib/useScanFlow'
import { startJobPolling, type JobPollingController } from '@/lib/jobPolling'
import { toCoachAIError } from '@/lib/errors'
import { type JobStatus, type ScanResult } from '@/types'
import {
  getMyProfile,
  getMyAttendance,
  getMySchedule,
  getMyPerformance,
  getMyAnalyses,
  getMyReports,
  getMyObjectives,
  type MyProfile,
  type MyAttendance,
  type MySchedule,
  type MyPerformance,
  type MyAnalyses,
  type MyReports,
  type MyObjectives,
} from '@/lib/meApi'
import {
  ATTENDANCE_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  REPORT_TYPE_LABELS,
  STUDENT_STATUS_LABELS,
} from '@/lib/org'
import { formatDateMed, formatDateShort } from '@/lib/date'
import { analysisScore } from '@/lib/analysis'

type LoadState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: HubData }

type HubData = {
  profile: MyProfile
  attendance: MyAttendance
  schedule: MySchedule
  performance: MyPerformance
  analyses: MyAnalyses
  reports: MyReports
  objectives: MyObjectives
}

export default function PlayerHub() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  // Refresh only the analyses slice after a player-initiated upload completes,
  // so the Analyses section picks up the new job without a full page reload.
  const refreshAnalyses = useCallback(async () => {
    try {
      const analyses = await getMyAnalyses()
      setState((prev) =>
        prev.status === 'ready' ? { status: 'ready', data: { ...prev.data, analyses } } : prev,
      )
    } catch {
      toast.error('Failed to refresh your analyses.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getMyProfile(),
      getMyAttendance(),
      getMySchedule(),
      getMyPerformance(),
      getMyAnalyses(),
      getMyReports(),
      getMyObjectives().catch(() => ({ objectives: [], linked: false })),
    ])
      .then(([profile, attendance, schedule, performance, analyses, reports, objectives]) => {
        if (cancelled) return
        setState({
          status: 'ready',
          data: { profile, attendance, schedule, performance, analyses, reports, objectives },
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const coachErr = error as CoachAIError
        setState({
          status: 'error',
          message: coachErr?.message ?? 'Failed to load your hub.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-3 p-8 text-muted-foreground">
        <Spinner /> Loading your hub…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-8">
        <p className="text-sm text-destructive">{state.message}</p>
      </div>
    )
  }

  const { profile, attendance, schedule, performance, analyses, reports, objectives } = state.data

  if (!profile.student) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          My Hub
        </p>
        <h1 className="mb-6 text-[28px] font-bold tracking-tight text-foreground">
          Welcome{profile.user?.name ? `, ${profile.user.name.split(' ')[0]}` : ''}
        </h1>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <p className="text-sm leading-6 text-muted-foreground">
            Your coach hasn&apos;t linked you to a team yet. Ask your coach to add your email (
            <span className="font-mono text-foreground">{profile.user?.email ?? 'your email'}</span>
            ) to your student profile and log in again.
          </p>
        </div>
      </div>
    )
  }

  const student = profile.student
  const attendanceRate = attendance.summary?.attendance_rate
  const upcoming = schedule.events
    .filter((e) => e.status === 'scheduled' && new Date(e.starts_at) >= new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]

  const kpis = [
    {
      label: 'Attendance Rate',
      value: attendanceRate === null || attendanceRate === undefined ? '—' : `${attendanceRate}%`,
      detail: attendance.summary
        ? `${attendance.summary.present} present · ${attendance.summary.absent} absent`
        : 'No sessions yet',
    },
    {
      label: 'Next Event',
      value: upcoming ? EVENT_TYPE_LABELS[upcoming.event_type] : '—',
      detail: upcoming
        ? `${formatDateMed(upcoming.starts_at)} · ${upcoming.title}`
        : 'Nothing scheduled',
    },
    {
      label: 'Analyses',
      value: String(analyses.analyses.length),
      detail: analyses.analyses.length
        ? `Latest: ${formatDateShort(analyses.analyses[0].requested_at)}`
        : 'No analyses yet',
    },
    {
      label: 'Reports',
      value: String(reports.reports.length),
      detail: reports.reports.length
        ? `Latest: ${formatDateShort(reports.reports[0].created_at)}`
        : 'No reports yet',
    },
    {
      label: 'Objectives',
      value: String(objectives.objectives.filter((o) => o.status === 'active').length),
      detail: objectives.objectives.length
        ? `${objectives.objectives.filter((o) => o.status === 'done').length} completed`
        : 'No objectives yet',
    },
  ]

  return (
    <div className="max-w-5xl p-8 lg:p-12">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        My Hub
      </p>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">{student.full_name}</h1>
      <div className="mb-8 mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {student.sport && <span>{student.sport}</span>}
        {student.jersey_number !== null && <span>#{student.jersey_number}</span>}
        {student.position && <span>{student.position}</span>}
        {student.status && <span>{STUDENT_STATUS_LABELS[student.status] ?? student.status}</span>}
      </div>

      {/* KPI cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {kpi.label}
            </p>
            <p className="mb-1 text-2xl font-bold tracking-tight text-foreground">{kpi.value}</p>
            <p className="text-xs text-muted-foreground">{kpi.detail}</p>
          </div>
        ))}
      </div>

      {/* Analyze my video */}
      <Section icon={<VideoIcon className="size-4" />} title="Analyze My Video">
        <AnalyzeVideoCard auth0Id={profile.user?.auth0_id} onCompleted={refreshAnalyses} />
      </Section>

      {/* Schedule */}
      <Section icon={<CalendarIcon className="size-4" />} title="Schedule">
        {schedule.events.length === 0 ? (
          <Empty>No upcoming events.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {schedule.events.slice(0, 8).map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{event.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateMed(event.starts_at)} · {EVENT_TYPE_LABELS[event.event_type]}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {EVENT_STATUS_LABELS[event.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Attendance */}
      <Section icon={<ClipboardListIcon className="size-4" />} title="Attendance">
        {attendance.records.length === 0 ? (
          <Empty>No attendance recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {attendance.records.slice(0, 8).map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {formatDateMed(record.session_date)}
                  </p>
                  {record.note && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{record.note}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs">
                  {ATTENDANCE_STATUS_LABELS[record.status] ?? record.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Performance */}
      <Section icon={<TrendingUpIcon className="size-4" />} title="Performance Trend">
        {performance.points.length === 0 ? (
          <Empty>No performance data yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {[...performance.points]
              .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
              .slice(0, 8)
              .map((point, index) => (
                <li
                  key={point.source_analysis_id ?? `${point.measured_at}-${index}`}
                  className="flex items-center justify-between gap-4 py-4"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {formatDateShort(point.measured_at)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {point.metric_key} ·{' '}
                      {point.source === 'analysis' ? 'from analysis' : 'manual'}
                    </p>
                  </div>
                  <span className="text-lg font-bold tracking-tight text-foreground">
                    {point.metric_value}
                    {point.unit ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        {' '}
                        {point.unit}
                      </span>
                    ) : (
                      ''
                    )}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      {/* Analyses */}
      <Section icon={<SparklesIcon className="size-4" />} title="Analyses">
        {analyses.analyses.length === 0 ? (
          <Empty>No analyses yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {analyses.analyses.slice(0, 8).map((analysis) => (
              <li
                key={analysis.server_job_id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {analysis.display_name || 'Untitled video'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateShort(analysis.requested_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {analysisScore(analysis) !== null && (
                    <span className="text-lg font-bold tracking-tight text-foreground">
                      {analysisScore(analysis)}
                    </span>
                  )}
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${
                      analysis.complete
                        ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {analysis.complete ? 'Done' : 'Processing'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Training objectives (set by your coach) */}
      <Section icon={<ActivityIcon className="size-4" />} title="Training Objectives">
        {objectives.objectives.length === 0 ? (
          <Empty>No objectives yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {objectives.objectives.slice(0, 8).map((objective) => (
              <li key={objective.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{objective.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {objective.due_on ? `Due ${objective.due_on}` : 'No due date'}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs capitalize ${
                    objective.status === 'done'
                      ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {objective.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Reports */}
      <Section icon={<ActivityIcon className="size-4" />} title="Reports">
        {reports.reports.length === 0 ? (
          <Empty>No reports yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {reports.reports.slice(0, 8).map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{report.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {REPORT_TYPE_LABELS[report.report_type] ?? report.report_type} ·{' '}
                    {formatDateShort(report.created_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {periodLabel(report.period_start, report.period_end)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

const STAGE_LABELS: Partial<Record<string, string>> = {
  uploading: 'Uploading video…',
  scanning: 'Scanning for players…',
  analyzing: 'Analyzing your video…',
}

/**
 * Player-side upload + analysis kickoff. Shares the coach flow's scan-phase
 * module (useScanFlow: validate → upload → SSE → select → angles) but kicks
 * off through /api/me/analyze so the server attributes it to this player
 * (requested_by) while keeping it visible to the coach in their history.
 */
function AnalyzeVideoCard({
  auth0Id,
  onCompleted,
}: {
  auth0Id?: string | null
  onCompleted: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<JobPollingController | null>(null)
  const liveRef = useRef(true)

  const [finished, setFinished] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    return () => {
      liveRef.current = false
      pollRef.current?.stop()
    }
  }, [])

  const flowResetRef = useRef(() => {})
  const lastToastKey = useRef<string | null>(null)

  const toastOnce = useCallback((code: string, message: string) => {
    const key = `${code}:${message}`
    if (lastToastKey.current === key) return
    lastToastKey.current = key
    toast.error(message)
  }, [])

  const runAnalysis = useCallback(
    (scan: ScanResult, playerIndex: number) => {
      setFinished(false)
      setLocalError(null)
      setPercent(0)

      const kickoff = async () => {
        try {
          const { job_id } = await meStartAnalysis({
            session_token: scan.session_token,
            player_index: playerIndex,
            video_key: scan.video_key,
            angle: scan.angle ?? null,
          })
          if (!liveRef.current) return
          pollRef.current?.stop()
          pollRef.current = startJobPolling<JobStatus>({
            jobId: job_id,
            fetchStatus: getJobStatus,
            isComplete: (status) => status.complete,
            intervalMs: 2000,
            timeoutMs: 12 * 60 * 1000,
            maxFailures: 5,
            onStatus: (status) => setPercent(Math.min(status.progress, 99)),
            onComplete: (status) => {
              if (status.error) {
                setLocalError(status.error)
                flowResetRef.current()
                toastOnce('ANALYSIS_FAILED', status.error)
              } else {
                setFinished(true)
                toast.success('Analysis complete — check your analyses below.')
                onCompleted()
              }
            },
            onError: (failure) => {
              setLocalError(failure.error.message)
              flowResetRef.current()
              toastOnce(failure.error.code, failure.error.message)
            },
          })
        } catch (e: unknown) {
          const err = toCoachAIError(e)
          if (!liveRef.current) return
          setLocalError(err.message)
          flowResetRef.current()
          toastOnce(err.code, err.message)
        }
      }
      void kickoff()
    },
    [onCompleted, toastOnce],
  )

  const flow = useScanFlow({ auth0Id: auth0Id ?? null, onAnalyze: runAnalysis })

  // Keep a stable reset that also clears card-local state.
  const reset = useCallback(() => {
    pollRef.current?.stop()
    pollRef.current = null
    flow.reset()
    setFinished(false)
    setFileName(null)
    setPercent(0)
    setLocalError(null)
    lastToastKey.current = null
  }, [flow])

  useEffect(() => {
    flowResetRef.current = reset
  }, [reset])

  // Surface flow errors inline; toast everything except client-side
  // validation (which stays inline-only, as before — no toast spam for a
  // wrong file pick). toastOnce dedupes against the analyze-path toasts.
  const flowError = flow.errorStatus
  useEffect(() => {
    if (!flowError || !liveRef.current) return
    setLocalError(flowError.message)
    if (flowError.layer !== 'client') toastOnce(flowError.code, flowError.message)
  }, [flowError, toastOnce])

  const activeScan =
    flow.angleScans.find((s) => (s.angle ?? 'primary') === flow.activeAngle) ??
    flow.scanResult

  const pick = useCallback(
    (file?: File) => {
      if (!file) return
      setFinished(false)
      setLocalError(null)
      lastToastKey.current = null
      setFileName(file.name)
      flow.handleFileSelected(file)
    },
    [flow],
  )

  const open = useCallback(() => fileInputRef.current?.click(), [])

  const stage = finished ? 'finished' : flow.phase
  const error = localError ?? flow.errorStatus?.message ?? null
  const scanPlayers = activeScan?.players ?? []
  // Upload/scan percent comes from the flow; analyzing percent from polling.
  const displayPercent =
    stage === 'analyzing' ? percent : (flow.uploadProgress?.percent ?? percent)

  if (stage === 'uploading' || stage === 'scanning' || stage === 'analyzing') {
    return (
      <div className="flex items-center gap-3">
        <Spinner />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{STAGE_LABELS[stage]}</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary/20">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(2, Math.min(displayPercent, 99))}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {stage === 'analyzing'
              ? 'This usually takes under a minute. The result will appear under Analyses.'
              : `${Math.round(displayPercent)}%`}
          </p>
        </div>
      </div>
    )
  }

  if (stage === 'selecting') {
    return (
      <div>
        <p className="mb-3 text-sm font-medium text-foreground">
          Multiple players detected — who should we analyze?
        </p>
        <div className="flex flex-wrap gap-2">
          {scanPlayers.map((player) => (
            <Button
              key={player.player_index}
              variant="outline"
              size="sm"
              onClick={() => flow.handlePlayerSelected(player.player_index)}
            >
              Player {player.player_index} · {Math.round(player.confidence * 100)}%
            </Button>
          ))}
        </div>
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={reset}>
            Start over
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {stage === 'finished' && (
        <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">
          Analysis complete — it&apos;s in your Analyses list below and in your coach&apos;s
          history.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          pick(e.dataTransfer.files[0])
        }}
        className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary/10'
            : 'border-border bg-background hover:border-primary/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <div className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
          <VideoIcon className="size-5" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">
          {fileName || 'Drop video or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">MP4, MOV, AVI · 500 MB max</p>
        <Button
          size="sm"
          className="mt-3"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
        >
          Choose video
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Your coach will see the result in their dashboard history, attributed to you.
      </p>
    </div>
  )
}

function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  return `${from ? formatDateShort(from) : ''}${from && to ? ' – ' : ''}${to ? formatDateShort(to) : ''}`
}
