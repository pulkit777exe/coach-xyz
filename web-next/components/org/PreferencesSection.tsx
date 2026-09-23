'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { Switch } from '@/components/9ui/ui/switch'
import { usePreferences, type ThemeChoice } from '@/lib/preferences'

const THEME_ITEMS: Record<string, string> = {
  system: 'Use system setting',
  light: 'Light',
  dark: 'Dark',
}

function Row({
  title,
  description,
  control,
}: {
  title: string
  description: string
  control: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-6 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export default function PreferencesSection() {
  const { prefs, setTheme, setWeekStartsMonday, setReduceMotion } = usePreferences()

  return (
    <div className="mt-4 rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Preferences
        </p>
      </div>
      <div className="divide-y divide-border">
        <div className="px-6 pt-4">
          <p className="text-sm font-medium text-foreground">Appearance</p>
        </div>
        <Row
          title="Theme"
          description="Choose a theme for CoachXYZ on this device."
          control={
            <Select
              items={THEME_ITEMS}
              value={prefs.theme}
              onValueChange={(v) => {
                if (v === 'system' || v === 'light' || v === 'dark') {
                  setTheme(v as ThemeChoice)
                }
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(THEME_ITEMS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Row
          title="Reduce motion"
          description="Minimize animations across the app."
          control={
            <Switch
              checked={prefs.reduceMotion}
              onCheckedChange={setReduceMotion}
              aria-label="Reduce motion"
            />
          }
        />
        <div className="px-6 pt-4">
          <p className="text-sm font-medium text-foreground">Calendar</p>
        </div>
        <Row
          title="Start week on Monday"
          description="Affects the way the schedule calendar lays out weeks."
          control={
            <Switch
              checked={prefs.weekStartsMonday}
              onCheckedChange={setWeekStartsMonday}
              aria-label="Start week on Monday"
            />
          }
        />
      </div>
    </div>
  )
}
