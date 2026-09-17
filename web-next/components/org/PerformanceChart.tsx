"use client"

import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/9ui/ui/chart"
import { formatDateShort } from "@/lib/date"

export default function PerformanceChart({
  data,
  config,
  keys,
}: {
  data: Record<string, string | number>[]
  config: ChartConfig
  keys: string[]
}) {
  return (
    <ChartContainer config={config} className="aspect-[16/7]">
      <LineChart data={data} margin={{ left: -14, right: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(v: string) => formatDateShort(v)}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} domain={["auto", "auto"]} />
        <ChartTooltip
          content={<ChartTooltipContent style={{ background: "var(--color-popover)" }} />}
          cursor={{ stroke: "var(--color-border)", strokeDasharray: "3 3" }}
        />
        {keys.map((key) => (
          <Line
            key={key}
            dataKey={key}
            name={key}
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