import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { getDashboardAnalysisDetail } from "@/lib/api";
import { redirect } from "next/navigation";
import AnalysisDetailClient from "@/components/AnalysisDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = await auth0.getSession();
  if (!session) return { title: "Analysis | CoachXYZ" };

  try {
    const res = await getDashboardAnalysisDetail(session.user.sub, id);
    const a = res.analysis;
    const label = a.display_name || a.file_name || id.slice(0, 8);
    const score =
      a.summary_json &&
      typeof a.summary_json === "object" &&
      "form_score" in a.summary_json
        ? ` — ${(a.summary_json as { form_score: number }).form_score}/10`
        : "";
    return {
      title: `${label}${score} | CoachXYZ`,
      description: a.complete
        ? `Analysis of ${label}${score}`
        : `Analysis in progress — ${label}`,
    };
  } catch {
    return { title: "Analysis | CoachXYZ" };
  }
}

export default async function AnalysisDetailPage({
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

  let data = null;
  try {
    const res = await getDashboardAnalysisDetail(auth0Id, id);
    data = res.analysis;
  } catch (err) {
    console.error("Failed to load analysis detail:", err);
    data = null;
  }

  return (
    <AnalysisDetailClient
      auth0Id={auth0Id}
      jobId={id}
      initialData={data}
    />
  );
}
