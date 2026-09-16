import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { getDashboardAnalyses } from "@/lib/api";
import { redirect } from "next/navigation";
import Link from "next/link";

export const metadata: Metadata = {
  title: "History | CoachXYZ",
  description: "Browse all your past video analyses.",
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const auth0Id = session.user.sub;
  const params = await searchParams;
  const rawPage = Number(params.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const perPage = 20;
  const offset = (page - 1) * perPage;

  // Fetch one extra to detect whether a next page exists without a separate count query
  let analyses: Awaited<ReturnType<typeof getDashboardAnalyses>>["analyses"] = [];
  let hasNextPage = false;
  let error = null;

  try {
    const res = await getDashboardAnalyses(auth0Id, perPage + 1, offset);
    hasNextPage = res.analyses.length > perPage;
    analyses = res.analyses.slice(0, perPage);
  } catch (err) {
    console.error("Failed to load history:", err);
    error = err instanceof Error ? err.message : "Failed to load history";
  }

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Analysis</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium">History</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">All Analyses</h1>
      <p className="mt-1 text-sm text-muted-foreground">Browse all your past video analyses.</p>

      {error && (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Failed to load history. Please try again later.
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-muted-foreground mb-4 text-sm">No analyses found</p>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Start Your First Analysis
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm divide-y divide-border">
            {analyses.map((a) => (
              <Link
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {a.display_name || a.file_name || "Untitled"}
                    {a.player_index !== null && ` — Player ${a.player_index}`}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {new Date(a.requested_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <span>{a.model}</span>
                    {a.file_size_bytes && (
                      <span>{(a.file_size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                    )}
                    {a.download_count > 0 && (
                      <span>{a.download_count} download{a.download_count > 1 ? "s" : ""}</span>
                    )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    {a.summary_json && typeof a.summary_json === "object" && "form_score" in a.summary_json ? (
                      <div className="text-right">
                        <p className="text-xl font-bold text-foreground">
                          {(a.summary_json as { form_score: number }).form_score}
                        </p>
                        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Score</p>
                      </div>
                    ) : null}
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                        a.complete
                          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                          : a.error_code
                            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                      }`}
                    >
                      {a.complete ? "Done" : a.error_code ? "Failed" : "Running"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {(page > 1 || hasNextPage) && (
              <div className="flex justify-center gap-3 mt-6">
                {page > 1 && (
                  <Link
                    href={`/dashboard/history?page=${page - 1}`}
                    className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
                  >
                    Previous
                  </Link>
                )}
                {hasNextPage && (
                  <Link
                    href={`/dashboard/history?page=${page + 1}`}
                    className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
                  >
                    Next
                  </Link>
                )}
              </div>
            )}
        </>
      )}
    </div>
  );
}
