import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { orgReports, orgStudents } from "@/lib/org";
import ReportsClient from "@/components/org/ReportsClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Reports | CoachXYZ",
  description: "Generate and browse progress, attendance, and performance reports.",
};

export default async function ReportsPage() {
  noStore();
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const auth0Id = session.user.sub;

  const [reportsRes, studentsRes] = await Promise.all([
    orgReports(auth0Id),
    orgStudents(auth0Id),
  ]);

  return (
    <div className="p-8 lg:p-12 max-w-6xl">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        Organization
      </p>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
        Reports
      </h1>

      {reportsRes.reports.length === 0 && (
        <p className="mb-6 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
          No data connection yet — generate reports below.
        </p>
      )}

      <ReportsClient
        auth0Id={auth0Id}
        initialReports={reportsRes.reports}
        students={studentsRes.students}
      />
    </div>
  );
}