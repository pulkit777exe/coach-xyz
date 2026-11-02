import type { ProfessionalStat, ProfessionalStatSource, ProfessionalStats } from '@/types'

// ── Professional analysis panel ──────────────────────────────────────────────
// The engine labels every row by how it was produced. This panel keeps that
// label visible instead of mixing measured numbers, event counts and model
// observations into one undifferentiated stat grid. The unavailable list is a
// first-class part of the card: a clip that cannot answer "xG" says so.

const SOURCE_META: Record<
  ProfessionalStatSource,
  { label: string; className: string; description: string }
> = {
  measured: {
    label: 'Measured',
    className: 'border-success/30 bg-success/10 text-success',
    description: 'computed from pose geometry or the event track',
  },
  counted: {
    label: 'Counted',
    className: 'border-border bg-accent text-foreground',
    description: 'a count or ratio of the events analysed',
  },
  observed: {
    label: 'Observed',
    className: 'border-warning/30 bg-warning/10 text-warning',
    description: 'a model judgement from the video, not a measurement',
  },
}

const BAND_LABEL: Record<string, string> = {
  target: 'In range',
  near: 'Near range',
  outside: 'Out of range',
  on_target: 'On target',
  developing: 'Developing',
  needs_work: 'Needs work',
  high: 'Low spread',
  moderate: 'Moderate spread',
  variable: 'High spread',
  strong: 'Strong coverage',
  fair: 'Fair coverage',
  low: 'Low coverage',
  tight: 'Tight',
  contested: 'Contested',
  open: 'Open',
}

function statValue(row: ProfessionalStat): string {
  if (row.display) return row.display
  if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return '—'
  if (Number.isInteger(row.value)) return `${row.value}${row.unit ?? ''}`
  const rounded = Math.abs(row.value) >= 10 ? row.value.toFixed(0) : row.value.toFixed(1)
  return `${rounded}${row.unit ?? ''}`
}

function SourcePill({ source }: { source: ProfessionalStatSource }) {
  // Unknown provenance falls back to the most conservative label. Defaulting to
  // "measured" would turn a wire-shape drift into a false claim of measurement.
  const meta = SOURCE_META[source] ?? SOURCE_META.observed
  return (
    <span
      title={meta.description}
      className={`inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-0.5 text-label font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}

function BandPill({ band, meaning }: { band: string; meaning?: string }) {
  return (
    <span
      title={meaning ?? band}
      className="inline-flex shrink-0 items-center rounded-[3px] border border-border px-1.5 py-0.5 text-label text-muted-foreground"
    >
      {BAND_LABEL[band] ?? band}
    </span>
  )
}

function StatRow({ row, bands }: { row: ProfessionalStat; bands: Record<string, string> }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body text-foreground">{row.label}</span>
          <SourcePill source={row.source} />
          {row.band ? <BandPill band={row.band} meaning={bands[row.band]} /> : null}
        </div>
        {row.note ? <p className="mt-0.5 text-meta text-muted-foreground">{row.note}</p> : null}
      </div>
      <span className="shrink-0 font-mono text-lead font-semibold tabular-nums text-foreground">
        {statValue(row)}
      </span>
    </li>
  )
}

export type ProStatsPanelProps = {
  stats?: ProfessionalStats | null
  tacticalSummary?: string | null
  keyInsights?: string[] | null
  title?: string
}

export default function ProStatsPanel({
  stats,
  tacticalSummary,
  keyInsights,
  title = 'Professional breakdown',
}: ProStatsPanelProps) {
  const groups = Array.isArray(stats?.groups) ? stats?.groups : []
  const insights = Array.isArray(keyInsights) ? keyInsights.filter(Boolean) : []
  const breakdown = Array.isArray(stats?.event_breakdown) ? stats?.event_breakdown : []
  const outcomes = Array.isArray(stats?.outcomes) ? stats?.outcomes : []
  const tags = Array.isArray(stats?.tags) ? stats?.tags : []
  const unavailable = Array.isArray(stats?.unavailable) ? stats?.unavailable : []
  const bands = stats?.bands && typeof stats.bands === 'object' ? stats.bands : {}
  const provenance = stats?.provenance
  const hasContent = groups.length > 0 || insights.length > 0 || Boolean(tacticalSummary)

  if (!hasContent) return null

  return (
    <section
      aria-labelledby="pro-stats-heading"
      className="rounded-[6px] border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="pro-stats-heading"
            className="text-lead font-semibold tracking-[-0.01em] text-foreground"
          >
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-meta text-muted-foreground">
            Every number is labelled by how it was produced. Rows that need ball tracking, a box
            score or whole-match context are listed as unavailable rather than estimated.
          </p>
        </div>
        {provenance ? (
          <div className="flex flex-wrap gap-2" aria-label="Stat provenance counts">
            <span className="rounded-[4px] border border-border px-2 py-1 text-label text-muted-foreground">
              <span className="tabular-nums text-foreground">{provenance.measured}</span> measured
            </span>
            <span className="rounded-[4px] border border-border px-2 py-1 text-label text-muted-foreground">
              <span className="tabular-nums text-foreground">{provenance.counted}</span> counted
            </span>
            <span className="rounded-[4px] border border-border px-2 py-1 text-label text-muted-foreground">
              <span className="tabular-nums text-foreground">{provenance.observed}</span> observed
            </span>
          </div>
        ) : null}
      </div>

      {(tacticalSummary || insights.length > 0) && (
        <div className="mt-4 rounded-[6px] border border-border bg-background p-4">
          <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Coach&apos;s read
          </p>
          {tacticalSummary ? (
            <p className="mt-1 text-body leading-[1.6] text-foreground">{tacticalSummary}</p>
          ) : null}
          {insights.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-muted-foreground">
              {insights.slice(0, 4).map((insight, index) => (
                <li key={index}>{insight}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {groups.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <div
              key={group.key}
              className="rounded-[6px] border border-border bg-background px-4 py-3"
            >
              <h3 className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.label}
              </h3>
              <ul className="mt-1 list-none p-0">
                {group.stats.map((row) => (
                  <StatRow key={row.key} row={row} bands={bands} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {(breakdown.length > 0 || outcomes.length > 0 || tags.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {breakdown.length > 0 && (
            <div className="rounded-[6px] border border-border bg-background p-4">
              <h3 className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Event mix
              </h3>
              <ul className="mt-2 list-none space-y-2 p-0">
                {breakdown.slice(0, 6).map((item) => (
                  <li key={item.type}>
                    <div className="flex items-center justify-between gap-2 text-meta">
                      <span className="text-foreground">{item.label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {item.count} · {item.share}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                      <div
                        className="h-full rounded-full bg-foreground/50"
                        style={{ width: `${Math.max(0, Math.min(100, item.share))}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outcomes.length > 0 && (
            <div className="rounded-[6px] border border-border bg-background p-4">
              <h3 className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Outcomes
              </h3>
              <ul className="mt-2 list-none space-y-1.5 p-0 text-body">
                {outcomes.map((item) => (
                  <li key={item.result} className="flex items-center justify-between gap-2">
                    <span className="text-foreground">{item.label}</span>
                    <span
                      className={`font-mono tabular-nums ${
                        item.tone === 'positive'
                          ? 'text-success'
                          : item.tone === 'negative'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {item.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tags.length > 0 && (
            <div className="rounded-[6px] border border-border bg-background p-4">
              <h3 className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Observed patterns
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag.tag}
                    className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-label text-warning"
                  >
                    {tag.tag}
                    {tag.count > 1 ? (
                      <span className="ml-1 tabular-nums text-warning/80">×{tag.count}</span>
                    ) : null}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-label text-muted-foreground">
                Model-observed labels, not measured values.
              </p>
            </div>
          )}
        </div>
      )}

      {stats?.trend ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border bg-background px-4 py-3">
          <div>
            <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Within-session trend
            </p>
            <p className="mt-0.5 text-body text-foreground capitalize">
              {stats.trend.direction} · {stats.trend.first} → {stats.trend.second} /10
            </p>
            <p className="text-meta text-muted-foreground">
              {stats.trend.n} scored events, first half vs second half ·{' '}
              {SOURCE_META[stats.trend.source]?.label ?? 'Measured'}
            </p>
          </div>
          <span className="font-mono text-title tabular-nums text-foreground">
            {stats.trend.delta > 0 ? '+' : ''}
            {stats.trend.delta}
          </span>
        </div>
      ) : null}

      {unavailable.length > 0 && (
        <details className="mt-4 rounded-[6px] border border-border bg-background px-4 py-3">
          <summary className="cursor-pointer list-none text-body font-medium text-foreground">
            Stats this clip cannot produce
            <span className="ml-2 text-meta font-normal text-muted-foreground">
              {unavailable.length} listed, with reasons
            </span>
          </summary>
          <ul className="mt-2 list-none space-y-2 p-0">
            {unavailable.map((item) => (
              <li key={item.label}>
                <p className="text-body text-foreground">{item.label}</p>
                <p className="text-meta text-muted-foreground">{item.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
