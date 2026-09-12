import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { orgStudents, orgAttendance } from "@/lib/org";
import { toISODate } from "@/lib/date";
import AttendanceGrid from "@/components/org/AttendanceGrid";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Attendance | CoachXYZ",
  description: "Track session attendance day by day.",
};

export default async function AttendancePage() {
  noStore();
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const auth0Id = session.user.sub;

  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [studentsRes, attendanceRes] = await Promise.all([
    orgStudents(auth0Id),
    orgAttendance(auth0Id, { from: toISODate(first), to: toISODate(last) }),
  ]);

  const active = studentsRes.students.filter((s) => s.status === "active");

  return (
    <div className="p-8 lg:p-12 max-w-full">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        Organization
      </p>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
        Attendance
      </h1>

      {active.length === 0 && studentsRes.students.length > 0 && (
        <p className="mb-6 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
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
  );
}