"use client"

import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Pie,
  PieChart,
  Cell,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/9ui/ui/chart"

export type FormScorePoint = { label: string; score: number }
export type DonutSlice = { name: string; value: number; fill: string }

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-popover-foreground)",
}

export function FormScoreTrend({
  data,
  className,
}: {
  data: FormScorePoint[]
  className?: string
}) {
  const config: ChartConfig = {
    score: { label: "Form score", color: "#f0ebe1" },
  }

  return (
    <ChartContainer config={config} className={className}>
      <LineChart data={data} margin={{ left: -14, right: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis
          domain={[0, 10]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickCount={6}
        />
        <ChartTooltip
          content={<ChartTooltipContent style={{ background: "var(--color-popover)" }} />}
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
        />
        <Line
          dataKey="score"
          name="score"
          type="monotone"
          stroke="var(--color-score)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-score)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  )
}

export function AttendanceDonut({
  data,
  className,
}: {
  data: DonutSlice[]
  className?: string
}) {
  const config: ChartConfig = Object.fromEntries(
    data.map((d) => [d.name, { label: d.name, color: d.fill }]),
  )
  const total = data.reduce((acc, d) => acc + d.value, 0)

  return (
    <ChartContainer config={config} className={className}>
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              style={TOOLTIP_STYLE}
              hideLabel
              formatter={(value: number | string) => [
                `${value} (${Math.round((Number(value) / (total || 1)) * 100)}%)`,
                "",
              ]}
            />
          }
        />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={46}
          outerRadius={70}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} stroke="var(--color-background)" />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  )
}