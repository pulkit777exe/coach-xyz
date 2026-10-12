import type { Metadata } from 'next'
import { orgStudents, orgAttendance } from '@/lib/serverData'
import { toISODate } from '@/lib/date'
import AttendanceGrid from '@/components/org/AttendanceGrid'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Attendance | CoachXYZ',
  description: 'Track session attendance day by day.',
}

export default async function AttendancePage() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  // Bare fan-out (no fallbacks): failures throw into error.tsx, as before.
  const { auth0Id, data } = await loadPage('org', {
    students: ({ auth0Id }) => orgStudents(auth0Id),
    attendance: ({ auth0Id }) =>
      orgAttendance(auth0Id, { from: toISODate(first), to: toISODate(last) }),
  })
  const studentsRes = data.students
  const attendanceRes = data.attendance

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
          <p className="mt-4 rounded-lg border border-warning-border bg-warning/10 px-4 py-3 text-sm text-foreground">
            No active students — check the roster.
          </p>
        )}

        <AttendanceGrid
          auth0Id={auth0Id}
          students={active}
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
