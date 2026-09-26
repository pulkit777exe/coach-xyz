import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgStudents, orgAttendance } from '@/lib/serverData'
import { toISODate } from '@/lib/date'
import AttendanceGrid from '@/components/org/AttendanceGrid'
import PageHeader from '@/components/org/PageHeader'
import { hasPermission } from '@/lib/permissions'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Attendance | CoachXYZ',
  description: 'Track session attendance day by day.',
}

export default async function AttendancePage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id } = orgCtx
  // attendance.write mirrors the server floor on the attendance routes: the
  // grid hides what the server would reject for this role.
  const canWrite = hasPermission(orgCtx.role, 'attendance.write')

  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  const [studentsRes, attendanceRes] = await Promise.all([
    orgStudents(auth0Id),
    orgAttendance(auth0Id, { from: toISODate(first), to: toISODate(last) }),
  ])

  const active = studentsRes.students.filter((s) => s.status === 'active')

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Attendance']}
        title="Attendance"
        description="Track session attendance day by day."
      />
      <div className="mt-6">
        {active.length === 0 && studentsRes.students.length > 0 && (
          <p className="rounded-[6px] border border-warning-border bg-warning/10 px-4 py-3 text-body text-foreground">
            No active students — check the roster.
          </p>
        )}

        <AttendanceGrid
          auth0Id={auth0Id}
          students={active}
          canWrite={canWrite}
          initialRecords={attendanceRes.records.map((r) => ({
            student_id: r.student_id,
            session_date: r.session_date,
            status: r.status,
            note: r.note,
          }))}
        />
      </div>
    </div>
  )
}
