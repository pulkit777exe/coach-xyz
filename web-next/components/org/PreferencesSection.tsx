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
import Section from '@/components/org/Section'

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
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-[1.4] text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[1.5] text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export default function PreferencesSection() {
  const { prefs, setTheme, setWeekStartsMonday, setReduceMotion } = usePreferences()

  return (
    <Section title="Preferences">
      <p className="mb-1 text-[13px] font-medium leading-[1.4] text-foreground">Appearance</p>
      <div>
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
      </div>
      <p className="mb-1 mt-6 text-[13px] font-medium leading-[1.4] text-foreground">Calendar</p>
      <div>
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
    </Section>
  )
}
