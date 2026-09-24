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
import { ProgressBar } from '@/components/interior/progress-bar'
import PageHeader from '@/components/org/PageHeader'
import StatusPill, { type StatusTone } from '@/components/org/StatusPill'
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
      <div className="mx-auto max-w-[720px] px-6 py-6 lg:px-8">
        <PageHeader
          trail={['My Hub']}
          title={`Welcome${profile.user?.name ? `, ${profile.user.name.split(' ')[0]}` : ''}`}
        />
        <div className="rounded-[6px] border border-border bg-card p-6">
          <p className="text-[14px] leading-6 text-muted-foreground">
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

  const hubMeta = [
    student.sport,
    student.jersey_number !== null ? `#${student.jersey_number}` : null,
    student.position,
    student.status ? (STUDENT_STATUS_LABELS[student.status] ?? student.status) : null,
  ].filter((v): v is string => Boolean(v))
  const hubDescription = hubMeta.length > 0 ? hubMeta.join(' · ') : undefined

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['My Hub', student.full_name || 'Details']}
        title={student.full_name || 'My Hub'}
        description={hubDescription}
      />
      {/* KPI stat tiles */}
      <div className="mt-8 mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-[6px] border border-border bg-card p-5">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {kpi.label}
            </p>
            <p className="mb-1.5 truncate text-[28px] font-semibold leading-none tabular-nums text-foreground">
              {kpi.value}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">{kpi.detail}</p>
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
                  <p className="text-[14px] font-medium text-foreground">{event.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                    {formatDateMed(event.starts_at)} · {EVENT_TYPE_LABELS[event.event_type]}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
                <StatusPill tone={eventTone(event.status)}>
                  {EVENT_STATUS_LABELS[event.status]}
                </StatusPill>
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
                  <p className="text-[14px] font-medium text-foreground">
                    {formatDateMed(record.session_date)}
                  </p>
                  {record.note && (
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{record.note}</p>
                  )}
                </div>
                <StatusPill tone={attendanceTone(record.status)}>
                  {ATTENDANCE_STATUS_LABELS[record.status] ?? record.status}
                </StatusPill>
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
                    <p className="text-[14px] font-medium text-foreground">
                      {formatDateShort(point.measured_at)}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {point.metric_key} ·{' '}
                      {point.source === 'analysis' ? 'from analysis' : 'manual'}
                    </p>
                  </div>
                  <span className="text-[17px] font-semibold tabular-nums text-foreground">
                    {point.metric_value}
                    {point.unit ? (
                      <span className="text-[13px] font-normal text-muted-foreground">
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
                  <p className="truncate text-[14px] font-medium text-foreground">
                    {analysis.display_name || 'Untitled video'}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                    {formatDateShort(analysis.requested_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {analysisScore(analysis) !== null && (
                    <span className="text-[17px] font-semibold tabular-nums text-foreground">
                      {analysisScore(analysis)}
                    </span>
                  )}
                  <StatusPill tone={analysis.complete ? 'green' : 'gray'}>
                    {analysis.complete ? 'Done' : 'Processing'}
                  </StatusPill>
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
                  <p className="truncate text-[14px] font-medium text-foreground">
                    {objective.title}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                    {objective.due_on ? `Due ${objective.due_on}` : 'No due date'}
                  </p>
                </div>
                <StatusPill tone={objective.status === 'done' ? 'green' : 'gray'}>
                  <span className="capitalize">{objective.status}</span>
                </StatusPill>
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
                  <p className="text-[14px] font-medium text-foreground">{report.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                    {REPORT_TYPE_LABELS[report.report_type] ?? report.report_type} ·{' '}
                    {formatDateShort(report.created_at)}
                  </p>
                </div>
                <StatusPill tone="gray">{periodLabel(report.period_start, report.period_end)}</StatusPill>
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
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-2 border-b border-border pb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-[14px] text-muted-foreground">{children}</p>
}

function eventTone(status: string): StatusTone {
  if (status === 'completed') return 'green'
  if (status === 'cancelled' || status === 'canceled') return 'red'
  return 'gray'
}

function attendanceTone(status: string): StatusTone {
  if (status === 'present') return 'green'
  if (status === 'absent') return 'red'
  if (status === 'late') return 'amber'
  return 'gray'
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
          <ProgressBar
            value={displayPercent > 0 ? Math.min(displayPercent, 99) : null}
            label={STAGE_LABELS[stage] ?? 'Working'}
            pendingLabel="Starting"
            completeLabel="Analysis complete"
            className="min-w-0 flex-1"
          />
          {stage === 'analyzing' && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              This usually takes under a minute. The result will appear under Analyses.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (stage === 'selecting') {
    return (
      <div>
        <p className="mb-3 text-[14px] font-medium text-foreground">
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
        <p className="mb-3 text-[14px] text-success">
          Analysis complete — it&apos;s in your Analyses list below and in your coach&apos;s
          history.
        </p>
      )}
      {error && <p className="mb-3 text-[13px] text-destructive">{error}</p>}
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
        className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-[6px] border-2 border-dashed p-5 text-center transition-colors ${
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
        <p className="mt-3 text-[14px] font-medium text-foreground">
          {fileName || 'Drop video or click to browse'}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">MP4, MOV, AVI · 500 MB max</p>
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
      <p className="mt-3 text-[13px] text-muted-foreground">
        Your coach will see the result in their dashboard history, attributed to you.
      </p>
    </div>
  )
}

function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  return `${from ? formatDateShort(from) : ''}${from && to ? ' – ' : ''}${to ? formatDateShort(to) : ''}`
}
