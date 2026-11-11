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
  )
}
