import { auth0 } from "@/lib/auth0";
import { getDashboardAnalysisDetail } from "@/lib/api";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth0.getSession();
  const auth0Id = session!.user.sub;

  let analysis = null;

  try {
    const res = await getDashboardAnalysisDetail(auth0Id, id);
    analysis = res.analysis;
  } catch (error) {
    console.error("Failed to load analysis:", error);
    notFound();
  }

  if (!analysis) {
    notFound();
  }

  const summary = analysis.summary_json as Record<string, unknown> | null;

  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)]">
        <Link href="/dashboard" className="hover:text-[var(--fg)] transition-colors">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/dashboard/history" className="hover:text-[var(--fg)] transition-colors">
          History
        </Link>
        <span>/</span>
        <span className="text-[var(--fg)]">{analysis.engine_job_id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-12">
        <div>
          <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
            Analysis Detail
          </p>
          <h1 className="font-serif text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.02em] text-[var(--fg)]">
            {analysis.file_name || "Untitled video"}
          </h1>
          <div className="mt-4 flex items-center gap-4 text-[0.65rem] text-[var(--cream-40)]">
            <span>
              {new Date(analysis.requested_at).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {analysis.model && <span>{analysis.model}</span>}
            {analysis.player_count && (
              <span>{analysis.player_count} player{analysis.player_count > 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
        <span
          className={`text-[0.6rem] uppercase tracking-[0.15em] px-3 py-1.5 border ${
            analysis.complete
              ? "border-[var(--cream-10)] text-[var(--cream-40)]"
              : analysis.error_code
                ? "border-[var(--red)] text-[var(--red)]"
                : "border-[var(--cream-20)] text-[var(--cream-20)]"
          }`}
        >
          {analysis.complete ? "Complete" : analysis.error_code ? "Failed" : "In Progress"}
        </span>
      </div>

      {/* Error State */}
      {analysis.error_code && (
        <div className="border border-[var(--red)] p-8 mb-8">
          <p className="text-[0.6rem] uppercase tracking-[0.25em] text-[var(--red)] mb-4">
            Error — {analysis.error_code}
          </p>
          <p className="text-sm text-[var(--cream-40)]">{analysis.error_message}</p>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--cream-05)] mb-8">
          {[
            {
              label: "Form Score",
              value: "form_score" in summary ? (summary.form_score as number) : "—",
            },
            {
              label: "Confidence",
              value: "confidence" in summary
                ? `${((summary.confidence as number) * 100).toFixed(0)}%`
                : "—",
            },
            {
              label: "Total Events",
              value: "total_events" in summary ? (summary.total_events as number) : "—",
            },
            {
              label: "Duration",
              value: "duration_sec" in summary
                ? `${Math.round(summary.duration_sec as number)}s`
                : "—",
            },
          ].map((card) => (
            <div key={card.label} className="bg-[var(--bg)] p-6">
              <p className="font-serif text-3xl text-[var(--fg)]">{card.value}</p>
              <p className="mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)]">
                {card.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Event Timeline */}
      {summary && "events" in summary && Array.isArray(summary.events) && (
        <div className="border border-[var(--cream-10)] p-8 mb-8">
          <p className="mb-6 text-[0.6rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
            Event Timeline
          </p>
          <div className="space-y-0">
            {(summary.events as Array<Record<string, unknown>>).map((event, i) => (
              <div
                key={i}
                className={`flex items-start gap-4 py-3 ${
                  i < (summary.events as unknown[]).length - 1
                    ? "border-b border-[var(--cream-05)]"
                    : ""
                }`}
              >
                {typeof event.timestamp === "number" && (
                  <span className="font-mono text-xs text-[var(--cream-40)] tabular-nums w-16 shrink-0">
                    {Math.floor(event.timestamp / 60)}:
                    {String(Math.round(event.timestamp % 60)).padStart(2, "0")}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--fg)]">
                    {typeof event.type === "string" ? event.type : "Event"}
                    {typeof event.subtype === "string" && (
                      <span className="text-[var(--cream-40)]"> — {event.subtype}</span>
                    )}
                  </p>
                  {typeof event.description === "string" && (
                    <p className="mt-1 text-xs text-[var(--cream-40)]">{event.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="border border-[var(--cream-10)] p-8">
        <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-[var(--cream-40)]">
          Metadata
        </p>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)] mb-1">
              Job ID
            </dt>
            <dd className="text-[var(--fg)] font-mono text-xs break-all">{analysis.engine_job_id}</dd>
          </div>
          {analysis.session_token && (
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)] mb-1">
                Session Token
              </dt>
              <dd className="text-[var(--fg)] font-mono text-xs break-all">{analysis.session_token}</dd>
            </div>
          )}
          {analysis.completed_at && (
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)] mb-1">
                Completed
              </dt>
              <dd className="text-[var(--fg)]">
                {new Date(analysis.completed_at).toLocaleString()}
              </dd>
            </div>
          )}
          {analysis.download_count > 0 && (
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.2em] text-[var(--cream-40)] mb-1">
                Downloads
              </dt>
              <dd className="text-[var(--fg)]">{analysis.download_count}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
