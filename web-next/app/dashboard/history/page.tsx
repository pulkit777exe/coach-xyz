import { auth0 } from "@/lib/auth0";
import { getDashboardAnalyses } from "@/lib/api";
import Link from "next/link";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth0.getSession();
  const auth0Id = session!.user.sub;
  const params = await searchParams;
  const page = Math.max(Number(params.page || 1), 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;

  let analyses: Awaited<ReturnType<typeof getDashboardAnalyses>>["analyses"] = [];

  try {
    const res = await getDashboardAnalyses(auth0Id, perPage, offset);
    analyses = res.analyses;
  } catch (error) {
    console.error("Failed to load history:", error);
  }

  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
        History
      </p>
      <h1 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em] text-[var(--fg)] mb-12">
        All Analyses
      </h1>

      {analyses.length === 0 ? (
        <div className="border border-[var(--cream-10)] p-12 text-center">
          <p className="text-[var(--cream-40)] mb-4">No analyses found</p>
          <Link
            href="/"
            className="border border-[var(--cream-10)] px-6 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-[var(--fg)] transition-all hover:bg-[var(--fg)] hover:text-[var(--bg)]"
          >
            Start Your First Analysis
          </Link>
        </div>
      ) : (
        <>
          <div className="border border-[var(--cream-10)] divide-y divide-[var(--cream-05)]">
            {analyses.map((a) => (
              <Link
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                className="flex items-center justify-between p-6 transition-colors hover:bg-[var(--cream-03)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--fg)] truncate">
                    {a.file_name || "Untitled video"}
                    {a.player_index !== null && ` — Player ${a.player_index}`}
                  </p>
                  <div className="mt-2 flex items-center gap-4 text-[0.6rem] text-[var(--cream-40)]">
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
                <div className="flex items-center gap-4 ml-4">
                  {a.summary_json && typeof a.summary_json === "object" && "form_score" in a.summary_json ? (
                    <div className="text-right">
                      <p className="font-serif text-2xl text-[var(--fg)]">
                        {(a.summary_json as { form_score: number }).form_score}
                      </p>
                      <p className="text-[0.55rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">
                        Score
                      </p>
                    </div>
                  ) : null}
                  <span
                    className={`text-[0.6rem] uppercase tracking-[0.15em] px-3 py-1.5 border ${
                      a.complete
                        ? "border-[var(--cream-10)] text-[var(--cream-40)]"
                        : a.error_code
                          ? "border-[var(--red)] text-[var(--red)]"
                          : "border-[var(--cream-20)] text-[var(--cream-20)]"
                    }`}
                  >
                    {a.complete ? "Done" : a.error_code ? "Failed" : "Running"}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {analyses.length === perPage && (
            <div className="flex justify-center gap-4 mt-8">
              {page > 1 && (
                <Link
                  href={`/dashboard/history?page=${page - 1}`}
                  className="border border-[var(--cream-10)] px-4 py-2 text-[0.65rem] uppercase tracking-[0.2em] text-[var(--fg)] transition-all hover:bg-[var(--fg)] hover:text-[var(--bg)]"
                >
                  Previous
                </Link>
              )}
              <Link
                href={`/dashboard/history?page=${page + 1}`}
                className="border border-[var(--cream-10)] px-4 py-2 text-[0.65rem] uppercase tracking-[0.2em] text-[var(--fg)] transition-all hover:bg-[var(--fg)] hover:text-[var(--bg)]"
              >
                Next
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
