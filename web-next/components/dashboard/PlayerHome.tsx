import PlayerHub from '@/components/player/PlayerHub'

/**
 * Org-role players landing on /dashboard get the REAL self-scoped experience:
 * PlayerHub (the same client hub served at /player) — breadcrumb + KPIs,
 * upload, schedule, attendance, performance, analyses, objectives, reports.
 * PlayerHub fetches only /api/me/* endpoints and owns its page shell, so this
 * stays a thin wrapper.
 */
export default function PlayerHome() {
  return <PlayerHub />
}
