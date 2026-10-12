import type { Metadata } from 'next'
import PlayerHub from '@/components/player/PlayerHub'
import { loadPage } from '../dashboard/_shell'

export const metadata: Metadata = {
  title: 'My Hub | CoachXYZ',
  description: 'Your attendance, schedule, performance and reports.',
}

export default async function PlayerPage() {
  // Player gate: fresh render + login guard + coach bounce to /dashboard.
  await loadPage('player')

  return <PlayerHub />
}
