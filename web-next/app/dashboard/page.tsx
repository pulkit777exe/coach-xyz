import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { getDashboardStats, getDashboardAnalyses } from "@/lib/api";
import { orgOverview, orgAttendanceSummary } from "@/lib/org";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  FormScoreTrend,
  AttendanceDonut,
  type FormScorePoint,
  type DonutSlice,
} from "@/components/org/OrgCharts";

export const metadata: Metadata = {
  title: "Dashboard | CoachXYZ",
  description: "Overview of your analyses and activity.",
};

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const auth0Id = session.user.sub;

  let stats = null;
  let analyses = null;
  let overview = null;
  let attendance = null;
  let error: string | null = null;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [statsRes, analysesRes, overviewRes, attendanceRes] = await Promise.all([
      getDashboardStats(auth0Id),
      getDashboardAnalyses(auth0Id, 20, 0),
      orgOverview(auth0Id),
      orgAttendanceSummary(auth0Id, { from: thirtyDaysAgo.toISOString().slice(0, 10) }),
    ]);
    stats = statsRes.stats;
    analyses = analysesRes.analyses;
    overview = overviewRes.overview;
    attendance = attendanceRes.summary;
  } catch (err) {
    console.error("Failed to load dashboard data:", err);
    error = err instanceof Error ? err.message : "Failed to load dashboard data";
  }

  // Form score trend (org-wide) from completed analyses
  const scoreByDate = new Map<string, { sum: number; count: number }>();
  for (const a of analyses ?? []) {
    if (!a.complete || !a.summary_json) continue;
    const score = (a.summary_json as Record<string, unknown>).form_score;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    const date = a.requested_at.slice(0, 10);
    const cur = scoreByDate.get(date) ?? { sum: 0, count: 0 };
    scoreByDate.set(date, { sum: cur.sum + score, count: cur.count + 1 });
  }
  const formScorePoints: FormScorePoint[] = [...scoreByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([date, { sum, count }]) => ({
      label: dayLabel(date),
      score: Math.round((sum / count) * 10) / 10,
    }));

  const attendanceSlices: DonutSlice[] = [
    {
      name: "Present",
      value: attendance?.present ?? 0,
      fill: "var(--color-success)",
    },
    {
      name: "Late",
      value: attendance?.late ?? 0,
      fill: "var(--color-warning)",
    },
    {
      name: "Absent",
      value: attendance?.absent ?? 0,
      fill: "var(--color-destructive)",
    },
    {
      name: "Excused",
      value: attendance?.excused ?? 0,
      fill: "var(--color-info)",
    },
  ].filter((s) => s.value > 0);

  const orgCards = [
    { label: "Students", value: overview?.student_count ?? 0, href: "/dashboard/students" },
    { label: "Active", value: overview?.active_students ?? 0, href: "/dashboard/students" },
    {
      label: "Sessions / Month",
      value: overview?.sessions_this_month ?? 0,
      href: "/dashboard/schedule",
    },
    {
      label: "Upcoming",
      value: overview?.upcoming_events ?? 0,
      href: "/dashboard/schedule",
    },
    {
      label: "Attendance (30d)",
      value: attendance?.attendance_rate ?? null,
      href: "/dashboard/attendance",
      suffix: "%",
    },
    {
      label: "Analyses Linked",
      value: overview?.analyses_linked ?? 0,
      href: "/dashboard/students",
    },
  ];

  return (
    <div className="p-8 lg:p-12 max-w-6xl">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        Dashboard
      </p>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
        Welcome back{session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
      </h1>

      {/* Error Banner */}
      {error && (
        <div className="border border-(--red) p-4 mb-8">
          <p className="text-sm text-(--red)">Failed to load dashboard data. Please try again later.</p>
        </div>
      )}

      {/* Organization Overview */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Organization
          </p>
          <Link
            href="/dashboard/students"
            className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
          >
            Manage Roster
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-(--cream-05) mb-6">
          {orgCards.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="group bg-(--bg) p-6 transition-colors hover:bg-(--cream-03)"
            >
              <p className="font-serif text-3xl text-(--fg)">
                {stat.value === null ? "—" : stat.value}
                {stat.suffix ?? ""}
              </p>
              <p className="mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
                {stat.label}
              </p>
            </Link>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-px bg-(--cream-05)">
          <div className="bg-(--bg) p-6">
            <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
              Form Score Trend
            </p>
            {formScorePoints.length ? (
              <FormScoreTrend data={formScorePoints} className="aspect-[16/9] md:aspect-[4/3]" />
            ) : (
              <div className="h-40 flex items-center justify-center">
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40)">
                  No analyzed sessions yet
                </p>
              </div>
            )}
          </div>
          <div className="bg-(--bg) p-6">
            <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
              Attendance — Last 30 Days
            </p>
            {attendanceSlices.length ? (
              <AttendanceDonut
                data={attendanceSlices}
                className="aspect-[16/9] md:aspect-[4/3]"
              />
            ) : (
              <div className="h-40 flex items-center justify-center">
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40)">
                  No attendance recorded yet
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-(--cream-05) mb-12">
          {[
            { label: "Total Analyses", value: stats.total_analyses },
            { label: "Completed", value: stats.completed_analyses },
            { label: "In Progress", value: stats.in_progress_analyses },
            { label: "Downloads", value: stats.total_downloads },
          ].map((stat) => (
            <div key={stat.label} className="bg-(--bg) p-6">
              <p className="font-serif text-3xl text-(--fg)">{stat.value}</p>
              <p className="mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Recent Analyses */}
      <div className="border border-(--cream-10) p-8">
        <div className="flex items-center justify-between mb-6">
          <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Recent Activity
          </p>
          <Link
            href="/dashboard/history"
            className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
          >
            View All
          </Link>
        </div>

        {!analyses || analyses.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-(--cream-40) mb-4">No analyses yet</p>
            <Link
              href="/"
              className="border border-(--cream-10) px-6 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-(--fg) transition-all hover:bg-(--fg) hover:text-(--bg)"
            >
              Start Your First Analysis
            </Link>
          </div>
        ) : (
          <div className="space-y-0">
            {analyses.slice(0, 5).map((a, i) => (
              <Link
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                className={`flex items-center justify-between py-4 transition-colors hover:bg-(--cream-03) -mx-4 px-4 ${
                  i < Math.min(analyses.length, 5) - 1 ? "border-b border-(--cream-05)" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-(--fg) truncate">
                    {a.display_name || a.file_name || "Untitled video"}
                    {a.player_index !== null && ` — Player ${a.player_index}`}
                  </p>
                  <p className="mt-1 text-[0.6rem] text-(--cream-40)">
                    {new Date(a.requested_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-4 ml-4">
                  {a.summary_json && typeof a.summary_json === "object" && "form_score" in a.summary_json ? (
                    <span className="font-serif text-lg text-(--fg)">
                      {(a.summary_json as { form_score: number }).form_score}
                    </span>
                  ) : null}
                  <span
                    className={`text-[0.6rem] uppercase tracking-[0.15em] px-2 py-1 border ${
                      a.complete
                        ? "border-(--cream-10) text-(--cream-40)"
                        : a.error_code
                          ? "border-(--red) text-(--red)"
                          : "border-(--cream-20) text-(--cream-20)"
                    }`}
                  >
                    {a.complete ? "Done" : a.error_code ? "Failed" : "Running"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}