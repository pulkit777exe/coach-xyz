import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { getOrgContext, getDashboardStats, getDashboardAnalyses } from "@/lib/serverData";
import { orgSchedule, orgReports, orgOverview } from "@/lib/serverData";
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
  Trophy,
  Video,
  BookOpen,
  Code2,
  Database,
  Layers,
  ShieldCheck,
  Zap,
  Info,
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
  const session = await getSession();
  if (!session) redirect("/auth/login");
  const { auth0Id } = await getOrgContext();

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
      {/* Getting Started header — Auth0 style */}
      <h1 className="text-[24px] font-bold tracking-tight text-foreground">Getting Started</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your coaching organization at a glance. Set up your roster, run your first analysis, and invite your team.</p>

      {/* Banner — New to CoachXYZ */}
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="grid size-6 place-items-center rounded-full bg-info/10 text-info"><Info className="size-4" /></span>
        <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">New to CoachXYZ?</span> Try our onboarding guide to get started. <Link href="/features" className="text-info underline decoration-info/30 hover:text-foreground">Start the guide.</Link></p>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          Failed to load dashboard data. Please try again later.
        </div>
      )}

      {/* Start Building — large card */}
      <h2 className="mt-8 text-[15px] font-semibold text-foreground">Start Building</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
          <div className="p-6 lg:p-7">
            <h3 className="text-[16px] font-semibold text-foreground">Analyze your first video</h3>
            <p className="mt-2 max-w-[420px] text-sm leading-5 text-muted-foreground">
              Integrate video analysis into your workflow or use one of our samples to get started in minutes. Six sports, one pipeline.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <Button render={<Link href="/#analyze" />} className="h-8 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Upload Video</Button>
              <Link href="/features" className="text-xs font-medium text-info hover:text-foreground">Learn More</Link>
            </div>
          </div>
          <div className="relative flex items-center justify-center bg-muted p-6 border-t lg:border-t-0 lg:border-l border-border">
            {/* sport icons cluster */}
            <div className="grid grid-cols-4 gap-2">
              {[
                {l:'BB', bg:'bg-chart-3'}, {l:'FB', bg:'bg-success'}, {l:'CR', bg:'bg-info'}, {l:'TN', bg:'bg-warning'},
                {l:'BB', bg:'bg-destructive'}, {l:'HK', bg:'bg-[var(--marketing-purple)]'}, {l:'PY', bg:'bg-warning'}, {l:'GO', bg:'bg-chart-5'},
              ].map(s=>(
                <span key={s.l+s.bg} className={`grid size-9 place-items-center rounded-full text-xs font-bold text-foreground ${s.bg}`}>{s.l}</span>
              ))}
            </div>
            <div className="absolute bottom-3 right-3 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground">6 sports • 60s</div>
          </div>
        </div>
      </div>

      {/* Organization overview — Next Steps 2x2 */}
      {tiles.length > 0 && (
        <>
          <h2 className="mt-8 text-[15px] font-semibold text-foreground">Next Steps</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {tiles.slice(0,4).map((t) => (
              <div key={t.label} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-muted text-info"><t.icon className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{t.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.value} {t.label.toLowerCase()} — {t.label === 'Students' ? 'add athletes to your roster' : t.label === 'Active Students' ? 'track active roster' : t.label === 'Sessions This Month' ? 'sessions recorded' : 'events scheduled'}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button variant="outline" size="sm" render={<Link href={t.href} />} className="h-7 rounded-md border-border bg-transparent px-3 text-xs text-foreground hover:bg-muted">{t.value} view</Button>
                  <Link href={t.href} className="text-xs font-medium text-info hover:text-foreground">Learn More</Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {!overview && !error && (
        <p className="mt-6 rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">No organization data yet — add students to get started.</p>
      )}

      {statCards.length > 0 && (
        <>
          <h2 className="mt-8 text-[15px] font-semibold text-foreground">Analyses</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground">Upcoming Events</CardTitle>
            <CardAction>
              <Button variant="link" size="sm" render={<Link href="/dashboard/schedule" />} className="text-info">
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

        <Card className="rounded-xl border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground">Recent Reports</CardTitle>
            <CardAction>
              <Button variant="link" size="sm" render={<Link href="/dashboard/reports" />} className="text-info">
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
                      className="flex items-center gap-2 -mx-2 rounded-md px-2 py-3 text-sm transition-colors hover:bg-muted"
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

      <Card className="mt-4 rounded-xl border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-foreground">Recent Activity</CardTitle>
          <CardAction>
            <Button variant="link" size="sm" render={<Link href="/dashboard/history" />} className="text-info">
              View All
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!analyses || analyses.length === 0 ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-sm text-muted-foreground">No analyses yet</p>
              <Button variant="outline" render={<Link href="/" />} className="border-border text-foreground hover:bg-muted">
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

      {/* Developer Tools — small icons grid like Auth0 */}
      <h2 className="mt-8 text-[15px] font-semibold text-foreground">Developer Tools</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          {icon: Video, title:"Player Hub", desc:"Athlete video and report portal"},
          {icon: Code2, title:"API Reference", desc:"Integrate analysis pipeline"},
          {icon: Database, title:"Bulk Import", desc:"Roster CSV and sync"},
          {icon: Layers, title:"Pipeline Status", desc:"Engine health and queue"},
          {icon: ShieldCheck, title:"Share Links", desc:"Time-boxed video shares"},
          {icon: Zap, title:"Webhooks", desc:"Notify on completion"},
          {icon: BookOpen, title:"Docs", desc:"Guides and sport configs"},
          {icon: Trophy, title:"Leaderboard", desc:"Top form scores"},
        ].map(c=>(
          <div key={c.title} className="flex gap-3 rounded-xl border border-border bg-card p-4">
            <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><c.icon className="size-4" /></span>
            <div>
              <p className="text-sm font-semibold text-foreground">{c.title}</p>
              <p className="text-xs text-muted-foreground">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
