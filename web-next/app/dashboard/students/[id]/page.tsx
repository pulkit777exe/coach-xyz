import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { redirect, notFound } from "next/navigation";
import { getDashboardAnalyses } from "@/lib/api";
import { orgStudent, orgStudentPerformance, orgAttendanceSummary, orgStudentsSports } from "@/lib/org";
import StudentProfile from "@/components/org/StudentProfile";
import { unstable_noStore as noStore } from "next/cache";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = await auth0.getSession();
  if (!session) return { title: "Student | CoachXYZ" };
  try {
    const res = await orgStudent(session.user.sub, id);
    return { title: `${res.student.full_name} | CoachXYZ` };
  } catch {
    return { title: "Student | CoachXYZ" };
  }
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  noStore();
  const { id } = await params;
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const auth0Id = session.user.sub;

  const studentRes = await orgStudent(auth0Id, id).catch(() => null);
  if (!studentRes) notFound();
  const student = studentRes.student;

  const [seriesRes, attRes, analysesRes, sportsRes] = await Promise.all([
    orgStudentPerformance(auth0Id, id).catch(() => ({ series: [] })),
    orgAttendanceSummary(auth0Id, { studentId: id }).catch(() => null),
    getDashboardAnalyses(auth0Id, 200, 0).catch(() => ({ analyses: [] })),
    orgStudentsSports(auth0Id).catch(() => ({ sports: [] })),
  ]);

  return (
    <div className="p-8 lg:p-12 max-w-6xl">
      <a
        href="/dashboard/students"
        className="mb-8 inline-block text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
      >
        ← Back to roster
      </a>

      <StudentProfile
        auth0Id={auth0Id}
        student={student}
        initialSeries={seriesRes.series}
        initialAttendance={attRes?.summary ?? null}
        allAnalyses={analysesRes.analyses}
        sports={sportsRes.sports}
      />
    </div>
  );
}