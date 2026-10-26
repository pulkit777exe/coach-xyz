import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgSchedule } from '@/lib/serverData'
import { scheduleMonthWindow } from '@/lib/date'
import ScheduleClient from '@/components/org/ScheduleClient'
import PageHeader from '@/components/org/PageHeader'
import { hasPermission } from '@/lib/permissions'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Schedule | CoachXYZ',
  description: 'Manage training sessions, matches, and team events.',
}

export default async function SchedulePage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id } = orgCtx
  // attendance.write is the same floor the server enforces on the schedule
  // write routes — calendar renders read-only without it.
  const canWrite = hasPermission(orgCtx.role, 'attendance.write')

  // Widen the window by one day on each side so month-boundary events are
  // captured regardless of the server timezone vs. the browser timezone.
  const { from, to } = scheduleMonthWindow(new Date())
  const scheduleRes = await orgSchedule(auth0Id, {
    from: from.toISOString(),
    to: to.toISOString(),
  })

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Schedule']}
        title="Schedule"
        description="Training sessions, matches, and team events."
      />
      <div className="mt-6">
        <ScheduleClient
          auth0Id={auth0Id}
          initialEvents={scheduleRes.events}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}
