import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { orgStudents, orgStudentsSports } from "@/lib/org";
import StudentsClient from "@/components/org/StudentsClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Students | CoachXYZ",
  description: "Manage your roster, attendance, and notes.",
};

export default async function StudentsPage() {
  noStore();
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const auth0Id = session.user.sub;

  const [studentsRes, sportsRes] = await Promise.all([
    orgStudents(auth0Id),
    orgStudentsSports(auth0Id),
  ]);

  return (
    <div className="p-8 lg:p-12 max-w-6xl">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        Organization
      </p>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
        Students
      </h1>

      {studentsRes.students.length === 0 && (
        <p className="mb-6 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
          No data connection yet — add students below.
        </p>
      )}

      <StudentsClient
        auth0Id={auth0Id}
        initialStudents={studentsRes.students}
        sports={sportsRes.sports}
      />
    </div>
  );
}