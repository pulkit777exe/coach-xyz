import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getOrgContext, orgReports, orgStudents } from "@/lib/serverData";
import ReportsClient from "@/components/org/ReportsClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Reports | CoachXYZ",
  description: "Generate and browse progress, attendance, and performance reports.",
};

export default async function ReportsPage() {
  noStore();
  const session = await getSession();
  if (!session) redirect("/auth/login");
  const { auth0Id } = await getOrgContext();

  const [reportsRes, studentsRes] = await Promise.all([
    orgReports(auth0Id),
    orgStudents(auth0Id),
  ]);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium">Reports</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">Generate and browse progress, attendance, and performance reports.</p>
      <div className="mt-6">
        <ReportsClient
          auth0Id={auth0Id}
          initialReports={reportsRes.reports}
          students={studentsRes.students}
        />
      </div>
    </div>
  );
}