import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { getDashboardStats, getDashboardAnalyses } from "@/lib/api";
import { orgSchedule, orgReports } from "@/lib/org";
import type { ScheduleEvent, ReportRecord } from "@/lib/org";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarIcon, FileTextIcon, ClockIcon } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/9ui/ui/card";
import { Badge } from "@/components/9ui/ui/badge";
import { Button } from "@/components/9ui/ui/button";

export const metadata: Metadata = {
  title: "Dashboard | CoachXYZ",
  description: "Overview of your analyses and activity.",
};

export default async function DashboardPage() {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const auth0Id = session.user.sub;

  let stats = null;
  let analyses = null;
  let upcomingEvents: ScheduleEvent[] | null = null;
  let recentReports: ReportRecord[] | null = null;
  let error: string | null = null;

  try {
    const now = new Date();
    const inThirtyDays = new Date();
    inThirtyDays.setDate(inThirtyDays.getDate() + 30);
    const [statsRes, analysesRes, scheduleRes, reportsRes] = await Promise.all([
      getDashboardStats(auth0Id),
      getDashboardAnalyses(auth0Id, 20, 0),
      orgSchedule(auth0Id, { from: now.toISOString(), to: inThirtyDays.toISOString() }),
      orgReports(auth0Id),
    ]);
    stats = statsRes.stats;
    analyses = analysesRes.analyses;
    upcomingEvents = scheduleRes.events
      .filter((e) => e.status === "scheduled" && new Date(e.starts_at).getTime() >= now.getTime())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 5);
    recentReports = reportsRes.reports.slice(0, 4);
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
        <div className="mb-8 rounded-md border border-danger bg-danger/10 px-4 py-3 text-sm text-danger">
          Failed to load dashboard data. Please try again later.
        </div>
      )}

      {/* Stats Grid */}
      {statCards.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.label} className="gap-0">
              <CardContent className="pb-6">
                <p className="font-serif text-3xl text-foreground">{stat.value}</p>
                <p className="mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
                  {stat.label}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upcoming & Reports */}
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardAction>
              <Button variant="link" size="sm" render={<Link href="/dashboard/schedule" />}>
                Schedule
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!upcomingEvents || upcomingEvents.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No upcoming events in the next 30 days.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {upcomingEvents.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
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
                        {new Date(e.starts_at).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Reports</CardTitle>
            <CardAction>
              <Button variant="link" size="sm" render={<Link href="/dashboard/reports" />}>
                All Reports
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!recentReports || recentReports.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No reports generated yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentReports.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/dashboard/reports/${r.id}`}
                      className="flex items-center gap-2 py-3 text-sm text-foreground transition-colors hover:text-muted-foreground"
                    >
                      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {r.full_name || "Organization"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Analyses */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
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
                  a.summary_json &&
                  typeof a.summary_json === "object" &&
                  "form_score" in a.summary_json
                    ? (a.summary_json as { form_score: number }).form_score
                    : null;
                return (
                  <li key={a.server_job_id}>
                    <Link
                      href={`/dashboard/analysis/${a.server_job_id}`}
                      className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {a.display_name || a.file_name || "Untitled video"}
                          {a.player_index !== null && ` — Player ${a.player_index}`}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
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
                        {score !== null && (
                          <span className="font-serif text-lg text-foreground">{score}</span>
                        )}
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