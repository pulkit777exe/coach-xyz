'use client'

import { Line, LineChart, XAxis, YAxis, CartesianGrid } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/9ui/ui/chart'
import { formatDateShort } from '@/lib/date'

export default function PerformanceChart({
  data,
  config,
  keys,
  label,
}: {
  data: Record<string, string | number>[]
  config: ChartConfig
  keys: string[]
  /** Accessible name for the chart (announced to assistive tech). */
  label?: string
}) {
  const seriesLabels = keys.map((k) => String(config[k]?.label ?? k))
  const chartLabel =
    label ?? (seriesLabels.length ? `Performance chart: ${seriesLabels.join(', ')}` : 'Performance chart')
  const latest = data[data.length - 1]
  const first = data[0]
  const rangeSummary =
    first && latest && typeof first.date === 'string' && typeof latest.date === 'string'
      ? ` covering ${formatDateShort(first.date)} to ${formatDateShort(latest.date)}`
      : ''
  const summary = latest
    ? `${data.length} data point${data.length === 1 ? '' : 's'}${rangeSummary}. Latest values: ${keys
        .map((k) => {
          const v = latest[k]
          const n = String(config[k]?.label ?? k)
          return typeof v === 'number' || typeof v === 'string' ? `${n} ${v}` : null
        })
        .filter(Boolean)
        .join(', ')}.`
    : 'No data points available.'

  return (
    <div>
      <ChartContainer
        config={config}
        className="aspect-[16/7]"
        role="img"
        aria-label={chartLabel}
        aria-roledescription="line chart"
      >
        <span className="sr-only">{summary}</span>
        <LineChart data={data} margin={{ left: -14, right: 8 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(v: string) => formatDateShort(v)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={44}
            domain={['auto', 'auto']}
          />
          <ChartTooltip
            content={<ChartTooltipContent style={{ background: 'var(--color-popover)' }} />}
            cursor={{ stroke: 'var(--color-border)', strokeDasharray: '3 3' }}
          />
          {keys.map((key) => (
            <Line
              key={key}
              dataKey={key}
              name={String(config[key]?.label ?? key)}
              type="monotone"
              stroke={config[key]?.color}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: config[key]?.color }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
      {data.length > 0 && (
        <details className="mt-3 rounded-[6px] border border-border bg-card">
          <summary className="cursor-pointer list-none px-3 py-2 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            View data table ({data.length} row{data.length === 1 ? '' : 's'})
          </summary>
          <div className="overflow-x-auto border-t border-border px-3 pb-3 pt-2">
            <table className="w-full min-w-[20rem] text-left text-meta">
              <caption className="sr-only">{chartLabel} data table</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">
                    Date
                  </th>
                  {keys.map((key) => (
                    <th key={key} scope="col" className="py-2 pr-3 font-medium text-muted-foreground">
                      {String(config[key]?.label ?? key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => {
                  const dateVal = row.date
                  const dateLabel =
                    typeof dateVal === 'string' ? formatDateShort(dateVal) : String(dateVal ?? '')
                  return (
                    <tr key={`${String(dateVal ?? idx)}-${idx}`} className="border-b border-border/60 last:border-b-0">
                      <th scope="row" className="py-2 pr-3 font-medium text-foreground">
                        {dateLabel}
                      </th>
                      {keys.map((key) => {
                        const v = row[key]
                        return (
                          <td key={key} className="py-2 pr-3 tabular-nums text-foreground">
                            {v === null || v === undefined || v === '' ? '—' : String(v)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
