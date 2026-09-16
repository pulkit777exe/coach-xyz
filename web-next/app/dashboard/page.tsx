import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { getDashboardStats, getDashboardAnalyses } from "@/lib/api";
import { orgSchedule, orgReports, orgOverview } from "@/lib/org";
import type { ScheduleEvent, ReportRecord, OrgOverview } from "@/lib/org";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  CalendarIcon,
  FileTextIcon,
  ClockIcon,
  UsersRound,
  UserCheck,
  ClipboardCheck,
  CalendarDays,
  History,
  Gauge,
} from "lucide-react";
import { unstable_noStore as noStore } from "next/cache";

import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/9ui/ui/card";
import { Badge } from "@/components/9ui/ui/badge";
import { Button } from "@/components/9ui/ui/button";

export const metadata: Metadata = {
  title: "Dashboard | CoachXYZ",
  description: "Overview of your organization, analyses, and activity.",
};

function overviewTiles(overview: OrgOverview) {
  return [
    { icon: UsersRound, label: "Students", value: overview.student_count, href: "/dashboard/students" },
    { icon: UserCheck, label: "Active Students", value: overview.active_students, href: "/dashboard/students" },
    { icon: ClipboardCheck, label: "Sessions This Month", value: overview.sessions_this_month, href: "/dashboard/attendance" },
    { icon: CalendarDays, label: "Upcoming Events", value: overview.upcoming_events, href: "/dashboard/schedule" },
    { icon: History, label: "Analyses Linked", value: overview.analyses_linked, href: "/dashboard/history" },
    {
      icon: Gauge,
      label: "Avg Attendance Rate",
      value: overview.avg_attendance_rate !== null ? `${overview.avg_attendance_rate}%` : "—",
      href: "/dashboard/reports",
    },
  ];
}

export default async function DashboardPage() {
  noStore();
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const auth0Id = session.user.sub;

  let stats = null;
  let analyses = null;
  let upcomingEvents: ScheduleEvent[] | null = null;
  let recentReports: ReportRecord[] | null = null;
  let overview: OrgOverview | null = null;
  let error: string | null = null;

  try {
    const now = new Date();
    const inThirtyDays = new Date();
    inThirtyDays.setDate(inThirtyDays.getDate() + 30);
    const [statsRes, analysesRes, scheduleRes, reportsRes, overviewRes] = await Promise.all([
      getDashboardStats(auth0Id),
      getDashboardAnalyses(auth0Id, 20, 0),
      orgSchedule(auth0Id, { from: now.toISOString(), to: inThirtyDays.toISOString() }),
      orgReports(auth0Id),
      orgOverview(auth0Id),
    ]);
    stats = statsRes.stats;
    analyses = analysesRes.analyses;
    upcomingEvents = scheduleRes.events
      .filter((e) => e.status === "scheduled" && new Date(e.starts_at).getTime() >= now.getTime())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 5);
    recentReports = reportsRes.reports.slice(0, 4);
    overview = overviewRes.overview;
  } catch (err) {
    console.error("Failed to load dashboard data:", err);
    error = err instanceof Error ? err.message : "Failed to load dashboard data";
  }

  const statCards = stats
    ? [
        { label: "Total Analyses", value: stats.total_analyses },
        { label: "Completed", value: stats.completed_analyses },
        { label: "In Progress", value: stats.in_progress_analyses },
        { label: "Downloads", value: stats.total_downloads },
      ]
    : [];

  const tiles = overview ? overviewTiles(overview) : [];

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium">Overview</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your organization at a glance.</p>

      {error && (
        <div className="mt-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Failed to load dashboard data. Please try again later.
        </div>
      )}

      {tiles.length > 0 && (
        <>
          <p className="mt-8 mb-3 text-[0.6rem] uppercase tracking-[0.25em] text-muted-foreground">Organization</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted"
              >
                <t.icon className="size-5 text-muted-foreground" />
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{t.value}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{t.label}</p>
              </Link>
            ))}
          </div>
        </>
      )}
      {!overview && !error && (
        <p className="text-muted-foreground mt-6 text-sm">No organization data yet — add students to get started.</p>
      )}

      {statCards.length > 0 && (
        <>
          <p className="mt-8 mb-3 text-[0.6rem] uppercase tracking-[0.25em] text-muted-foreground">Analyses</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {statCards.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-card p-5">
                <p className="text-2xl font-bold tracking-tight text-foreground">{stat.value}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Upcoming Events</CardTitle>
            <CardAction>
              <Button variant="link" size="sm" render={<Link href="/dashboard/schedule" />}>
                Schedule
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!upcomingEvents || upcomingEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No upcoming events in the next 30 days.</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcomingEvents.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        <CalendarIcon className="mr-2 inline size-3.5 text-muted-foreground" />
                        {e.title}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ClockIcon className="size-3" />
                        {new Date(e.starts_at).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                        {" · "}
                        {new Date(e.starts_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recent Reports</CardTitle>
            <CardAction>
              <Button variant="link" size="sm" render={<Link href="/dashboard/reports" />}>
                All Reports
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!recentReports || recentReports.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No reports generated yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentReports.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/dashboard/reports/${r.id}`}
                      className="flex items-center gap-2 -mx-2 rounded-md px-2 py-3 text-sm transition-colors hover:bg-muted/50"
                    >
                      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium text-foreground">{r.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.full_name || "Organization"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
          <CardAction>
            <Button variant="link" size="sm" render={<Link href="/dashboard/history" />}>
              View All
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!analyses || analyses.length === 0 ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-sm text-muted-foreground">No analyses yet</p>
              <Button variant="outline" render={<Link href="/" />}>
                Start Your First Analysis
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {analyses.slice(0, 5).map((a) => {
                const score =
                  a.summary_json && typeof a.summary_json === "object" && "form_score" in a.summary_json
                    ? (a.summary_json as { form_score: number }).form_score
                    : null;
                return (
                  <li key={a.server_job_id}>
                    <Link
                      href={`/dashboard/analysis/${a.server_job_id}`}
                      className="flex items-center justify-between gap-3 -mx-2 rounded-md px-2 py-3 transition-colors hover:bg-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {a.display_name || a.file_name || "Untitled video"}
                          {a.player_index !== null && ` — Player ${a.player_index}`}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(a.requested_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3">
                        {score !== null && <span className="text-base font-semibold text-foreground">{score}</span>}
                        <Badge variant={a.complete ? "success" : a.error_code ? "danger" : "secondary"}>
                          {a.complete ? "Done" : a.error_code ? "Failed" : "Running"}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}