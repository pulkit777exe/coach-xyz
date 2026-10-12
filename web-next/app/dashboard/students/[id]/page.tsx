import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getDashboardAnalyses, getOrgContext } from '@/lib/serverData'
import {
  orgStudent,
  orgStudentPerformance,
  orgAttendanceSummary,
  orgStudentsSports,
  orgReports,
  orgStudentAnalyses,
} from '@/lib/serverData'
import StudentProfile from '@/components/org/StudentProfile'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../../_shell'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const session = await getSession()
  if (!session) return { title: 'Student | CoachXYZ' }
  try {
    const { auth0Id } = await getOrgContext()
    const res = await orgStudent(auth0Id, id)
    return { title: `${res.student.full_name} | CoachXYZ` }
  } catch {
    return { title: 'Student | CoachXYZ' }
  }
}

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Critical fetch first: missing student → notFound before the fan-out.
  const { auth0Id, data: header } = await loadPage(
    'org',
    { student: ({ auth0Id }) => orgStudent(auth0Id, id) },
    { student: null },
  )
  const studentRes = header.student
  if (!studentRes) notFound()
  const student = studentRes.student

  const { data } = await loadPage(
    'org',
    {
      series: ({ auth0Id }) => orgStudentPerformance(auth0Id, id),
      attendance: ({ auth0Id }) => orgAttendanceSummary(auth0Id, { studentId: id }),
      linked: ({ auth0Id }) => orgStudentAnalyses(auth0Id, id),
      unlinked: ({ auth0Id }) => getDashboardAnalyses(auth0Id, 100, 0, { unlinked: true }),
      sports: ({ auth0Id }) => orgStudentsSports(auth0Id),
      reports: ({ auth0Id }) => orgReports(auth0Id, { studentId: id }),
    },
    {
      series: { series: [] },
      attendance: null,
      linked: { analyses: [] },
      unlinked: { analyses: [] },
      sports: { sports: [] },
      reports: { reports: [] },
    },
  )
  const seriesRes = data.series
  const attRes = data.attendance
  const linkedRes = data.linked
  const unlinkedRes = data.unlinked
  const sportsRes = data.sports
  const reportsRes = data.reports

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Students', student.full_name || 'Details']}
        title={student.full_name || 'Student details'}
      />
      <Link
        href="/dashboard/students"
        className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to roster
      </Link>

      <StudentProfile
        auth0Id={auth0Id}
        student={student}
        initialSeries={seriesRes.series}
        initialAttendance={attRes?.summary ?? null}
        initialReports={reportsRes.reports}
        allAnalyses={[...unlinkedRes.analyses, ...linkedRes.analyses]}
        sports={sportsRes.sports}
      />
    </div>
  )
}
