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
import SettingRow from '@/components/org/SettingRow'

const THEME_ITEMS: Record<string, string> = {
  system: 'Use system setting',
  light: 'Light',
  dark: 'Dark',
}

export default function PreferencesSection() {
  const { prefs, setTheme, setWeekStartsMonday, setReduceMotion } = usePreferences()

  return (
    <Section title="Preferences">
      <p className="mb-1 text-meta font-medium leading-[1.4] text-foreground">Appearance</p>
      <div>
        <SettingRow
          title="Theme"
          description="Choose a theme for CoachXYZ on this device."
        >
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
        </SettingRow>
        <SettingRow title="Reduce motion" description="Minimize animations across the app.">
          <Switch
            checked={prefs.reduceMotion}
            onCheckedChange={setReduceMotion}
            aria-label="Reduce motion"
          />
        </SettingRow>
      </div>
      <p className="mb-1 mt-6 text-meta font-medium leading-[1.4] text-foreground">Calendar</p>
      <div>
        <SettingRow
          title="Start week on Monday"
          description="Affects the way the schedule calendar lays out weeks."
        >
          <Switch
            checked={prefs.weekStartsMonday}
            onCheckedChange={setWeekStartsMonday}
            aria-label="Start week on Monday"
          />
        </SettingRow>
      </div>
    </Section>
  )
}
