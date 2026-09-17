import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getOrgContext, orgStudents, orgAttendance } from "@/lib/serverData";
import { toISODate } from "@/lib/date";
import AttendanceGrid from "@/components/org/AttendanceGrid";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Attendance | CoachXYZ",
  description: "Track session attendance day by day.",
};

export default async function AttendancePage() {
  noStore();
  const session = await getSession();
  if (!session) redirect("/auth/login");
  const { auth0Id } = await getOrgContext();

  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [studentsRes, attendanceRes] = await Promise.all([
    orgStudents(auth0Id),
    orgAttendance(auth0Id, { from: toISODate(first), to: toISODate(last) }),
  ]);

  const active = studentsRes.students.filter((s) => s.status === "active");

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium">Attendance</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Attendance</h1>
      <p className="mt-1 text-sm text-muted-foreground">Track session attendance day by day.</p>
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
  );
}