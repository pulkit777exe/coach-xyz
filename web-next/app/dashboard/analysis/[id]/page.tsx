import { auth0 } from "@/lib/auth0";
import { getDashboardAnalysisDetail } from "@/lib/api";
import { redirect } from "next/navigation";
import AnalysisDetailClient from "@/components/AnalysisDetailClient";

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
  } catch {
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
