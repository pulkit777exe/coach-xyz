import { auth0 } from "@/lib/auth0";
import { getDashboardStats, getDashboardAnalyses } from "@/lib/api";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const auth0Id = session.user.sub;

  let stats = null;
  let analyses = null;

  try {
    const [statsRes, analysesRes] = await Promise.all([
      getDashboardStats(auth0Id),
      getDashboardAnalyses(auth0Id, 5, 0),
    ]);
    stats = statsRes.stats;
    analyses = analysesRes.analyses;
  } catch (error) {
    console.error("Failed to load dashboard data:", error);
  }

  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        Dashboard
      </p>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
        Welcome back{session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}
      </h1>

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
            {analyses.map((a, i) => (
              <Link
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                className={`flex items-center justify-between py-4 transition-colors hover:bg-(--cream-03) -mx-4 px-4 ${
                  i < analyses.length - 1 ? "border-b border-(--cream-05)" : ""
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
