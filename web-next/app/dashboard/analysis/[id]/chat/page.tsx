import { auth0 } from "@/lib/auth0";
import { getDashboardAnalysisDetail, type DashboardAnalysis } from "@/lib/api";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import HistoryChat from "@/components/HistoryChat";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }
  const auth0Id = session.user.sub;

  const result = await getDashboardAnalysisDetail(auth0Id, id).catch(() => null);
  if (!result?.analysis) {
    notFound();
  }

  const data: DashboardAnalysis = result!.analysis;

  const summaryRaw = data.summary_json;
  const summary = summaryRaw && typeof summaryRaw === "object" && !Array.isArray(summaryRaw)
    ? (summaryRaw as Record<string, unknown>)
    : typeof summaryRaw === "string"
      ? (() => { try { return JSON.parse(summaryRaw) as Record<string, unknown> } catch { return null } })()
      : null;

  return (
    <div className="p-8 lg:p-12 max-w-3xl" style={{ height: "calc(100dvh - 4rem)" }}>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/dashboard/analysis/${id}`}
          className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to Analysis
        </Link>
        <span           className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
          Chat
        </span>
      </div>
      <div className="rounded-xl border border-border" style={{ height: "calc(100% - 3rem)" }}>
        <HistoryChat auth0Id={auth0Id} jobId={id} summary={summary} />
      </div>
    </div>
  );
}
