import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { redirect, notFound } from 'next/navigation'
import { getOrgContext, getDashboardAnalyses } from '@/lib/serverData'
import {
  orgStudent,
  orgStudentPerformance,
  orgAttendanceSummary,
  orgStudentsSports,
  orgReports,
  orgStudentAnalyses,
} from '@/lib/serverData'
import StudentProfile from '@/components/org/StudentProfile'
import { hasPermission } from '@/lib/permissions'
import PageHeader from '@/components/org/PageHeader'
import { connection } from 'next/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) return { title: 'Student | CoachXYZ' }

  try {
    const { auth0Id } = orgCtx
    const res = await orgStudent(auth0Id, id)
    return { title: `${res.student.full_name} | CoachXYZ` }
  } catch {
    return { title: 'Student | CoachXYZ' }
  }
}

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx

  const studentRes = await orgStudent(auth0Id, id).catch(() => null)
  if (!studentRes) notFound()
  const student = studentRes.student

  const [seriesRes, attRes, linkedRes, unlinkedRes, sportsRes, reportsRes] = await Promise.all([
    orgStudentPerformance(auth0Id, id).catch(() => ({ series: [] })),
    orgAttendanceSummary(auth0Id, { studentId: id }).catch(() => null),
    orgStudentAnalyses(auth0Id, id).catch(() => ({ analyses: [] })),
    getDashboardAnalyses(auth0Id, 100, 0, { unlinked: true }).catch(() => ({ analyses: [] })),
    orgStudentsSports(auth0Id).catch(() => ({ sports: [] })),
    orgReports(auth0Id, { studentId: id }).catch(() => ({ reports: [] })),
  ])

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Students', student.full_name || 'Details']}
        title={student.full_name || 'Student details'}
      />
      <Link
        href="/dashboard/students"
        className="mt-4 inline-flex items-center gap-1 text-meta text-muted-foreground transition-colors hover:text-foreground hover:underline"
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
        canWrite={hasPermission(role, 'player.manage')}
      />
    </div>
  )
}
