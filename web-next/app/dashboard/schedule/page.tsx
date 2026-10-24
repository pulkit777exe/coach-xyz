import type { Metadata } from 'next'
import { orgSchedule } from '@/lib/serverData'
import { scheduleMonthWindow } from '@/lib/date'
import ScheduleClient from '@/components/org/ScheduleClient'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Schedule | CoachXYZ',
  description: 'Plan practices, matches, and events.',
}

export default async function SchedulePage() {
  // Widen the window by one day on each side so month-boundary events are
  // captured regardless of the server timezone vs. the browser timezone.
  const { from, to } = scheduleMonthWindow(new Date())

  const { auth0Id, data } = await loadPage(
    'org',
    {
      schedule: ({ auth0Id }) =>
        orgSchedule(auth0Id, { from: from.toISOString(), to: to.toISOString() }),
    },
    { schedule: { events: [] } },
  )
  const res = data.schedule

  return (
    <div className="mx-auto max-w-\[1080px\] px-6 py-6 lg:px-8 bg-grid relative z-10">
      <PageHeader
        trail={['Home', 'Schedule']}
        title="Schedule"
        description="Plan practices, matches, and events."
      />
      <div className="mt-6">
        <ScheduleClient auth0Id={auth0Id} initialEvents={res.events} />
      </div>
    </div>
  )
}
