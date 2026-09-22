import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getOrgContext, orgAuditLogs } from "@/lib/serverData";
import AuditClient from "@/components/org/AuditClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Audit Log | CoachXYZ",
  description: "Sensitive organization actions, newest first.",
};

export default async function AuditPage() {
  noStore();
  const session = await getSession();
  if (!session) redirect("/auth/login");
  const { auth0Id } = await getOrgContext();

  let logs = null;
  try {
    const res = await orgAuditLogs(auth0Id, 100);
    logs = res.logs;
  } catch {
    logs = null;
  }

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground">Audit Log</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Audit Log</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sensitive organization actions, newest first.</p>

      <div className="mt-6">
        {logs === null ? (
          <p className="text-sm text-muted-foreground">
            Audit log unavailable — you may not have permission, or the history store is not configured.
          </p>
        ) : (
          <AuditClient initialLogs={logs} />
        )}
      </div>
    </div>
  );
}
