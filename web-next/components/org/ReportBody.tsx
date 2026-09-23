import type { ReportContent, ReportRecord } from '@/lib/org'
import { ATTENDANCE_STATUS_LABELS, STUDENT_STATUS_LABELS } from '@/lib/org'
import { formatDateMed } from '@/lib/date'

const TYPE_ORDER: Record<string, string[]> = {
  attendance: ['summary', 'org', 'attendance', 'performance', 'analyses'],
  performance: ['summary', 'org', 'performance', 'attendance', 'analyses'],
  progress: ['summary', 'org', 'attendance', 'performance', 'analyses'],
  monthly: ['summary', 'org', 'attendance', 'performance', 'analyses'],
}

export default function ReportBody({
  report,
  showGenerated = false,
}: {
  report: ReportRecord
  showGenerated?: boolean
}) {
  const c = report.content_json as ReportContent | null
  const has = (k: string) => {
    if (!c) return false
    if (k === 'org') return Boolean(c.org)
    if (k === 'summary') return typeof c.summary === 'string' && c.summary.length > 0
    if (k === 'attendance') return Boolean(c.attendance)
    if (k === 'performance') return Boolean(c.performance)
    if (k === 'analyses') return (c.analyses ?? []).length > 0
    return false
  }

  const order = TYPE_ORDER[report.report_type] ?? TYPE_ORDER.progress

  if (!c) {
    return <p className="text-muted-foreground text-[14px]">This report has no content.</p>
  }

  return (
    <div className="space-y-5 text-[14px]">
      {showGenerated &&
        (() => {
          const gen = c.generated_at
          if (!gen) return null
          return (
            <p className="text-muted-foreground text-[13px] tabular-nums">
              Generated{' '}
              {new Date(gen).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )
        })()}

      {c.period?.label && c.period.label !== 'All time' && (
        <p className="text-muted-foreground text-[13px]">{c.period.label}</p>
      )}

      {order.map((k) => {
        if (!has(k)) return null
        if (k === 'org') return <OrgStatStrip key={k} c={c} />
        if (k === 'summary') return <SummaryBlock key={k} c={c} />
        if (k === 'attendance') return <AttendanceBlock key={k} c={c} />
        if (k === 'performance') return <PerformanceBlock key={k} c={c} />
        if (k === 'analyses') return <AnalysesBlock key={k} c={c} />
        return null
      })}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-[0.08em]">{title}</p>
      {children}
    </div>
  )
}

function StatCells({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-card p-4">
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.08em]">
            {label}
          </p>
          <p className="mt-1.5 text-[28px] font-semibold leading-none tabular-nums text-foreground">
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

function SummaryBlock({ c }: { c: ReportContent }) {
  return (
    <div className="rounded-[6px] border border-border bg-muted p-4">
      <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em]">
        Summary
      </p>
      <p className="text-foreground text-[14px] leading-[1.55]">{c.summary}</p>
    </div>
  )
}

function OrgStatStrip({ c }: { c: ReportContent }) {
  const o = c.org
  if (!o) return null
  return (
    <Section title="Organization">
      <StatCells
        items={
          [
            ['Students', String(o.student_count)],
            [STUDENT_STATUS_LABELS.active, String(o.active_students)],
            ['Sessions this month', String(o.sessions_this_month)],
            ['Upcoming events', String(o.upcoming_events)],
            ['Analyses linked', String(o.analyses_linked)],
            ['Att rate (30d)', o.avg_attendance_rate === null ? '—' : `${o.avg_attendance_rate}%`],
          ].slice(0, 6) as [string, string][]
        }
      />
    </Section>
  )
}

function AttendanceBlock({ c }: { c: ReportContent }) {
  const a = c.attendance
  return (
    <Section title="Attendance">
      <StatCells
        items={[
          ['Records', String(a.total_records)],
          [ATTENDANCE_STATUS_LABELS.present, String(a.present)],
          [ATTENDANCE_STATUS_LABELS.late, String(a.late)],
          [ATTENDANCE_STATUS_LABELS.absent, String(a.absent)],
          [ATTENDANCE_STATUS_LABELS.excused, String(a.excused)],
          ['Rate', a.attendance_rate === null ? '—' : `${a.attendance_rate}%`],
        ]}
      />
    </Section>
  )
}

function PerformanceBlock({ c }: { c: ReportContent }) {
  const p = c.performance
  return (
    <Section title="Performance">
      <StatCells
        items={[
          ['Avg form', p.form_score_avg === null ? '—' : `${p.form_score_avg}/10`],
          ['Latest form', p.form_score_latest === null ? '—' : `${p.form_score_latest}/10`],
          ['Analyzed sessions', String(p.total_sessions)],
          [
            'Last analysis',
            p.latest_analysis_at ? formatDateMed(p.latest_analysis_at.slice(0, 10)) : '—',
          ],
        ]}
      />
    </Section>
  )
}

function AnalysesBlock({ c }: { c: ReportContent }) {
  const analyses = c.analyses ?? []
  return (
    <Section title="Referenced analyses">
      <ul className="space-y-0">
        {analyses.map((a) => (
          <li
            key={a.server_job_id}
            className="flex justify-between border-b border-border py-2 text-[14px] last:border-b-0"
          >
            <span className="text-foreground">{a.display_name || 'Untitled video'}</span>
            <span className="text-muted-foreground tabular-nums">
              {a.form_score === null ? '—' : `${a.form_score}/10`}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
