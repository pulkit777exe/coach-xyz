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
  description: 'Plan practices, matches, and events.',
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

  const res = await orgSchedule(auth0Id, { from: from.toISOString(), to: to.toISOString() }).catch(
    () => ({ events: [] }),
  )

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Schedule']}
        title="Schedule"
        description="Plan practices, matches, and events."
      />
      <div className="mt-6">
        <ScheduleClient auth0Id={auth0Id} canWrite={canWrite} initialEvents={res.events} />
      </div>
    </div>
  )
}
