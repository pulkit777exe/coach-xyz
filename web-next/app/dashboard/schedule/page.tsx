import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getOrgContext, orgSchedule } from "@/lib/serverData";
import { scheduleMonthWindow } from "@/lib/date";
import ScheduleClient from "@/components/org/ScheduleClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Schedule | CoachXYZ",
  description: "Plan practices, matches, and events.",
};

export default async function SchedulePage() {
  noStore();
  const session = await getSession();
  if (!session) redirect("/auth/login");
  const { auth0Id } = await getOrgContext();

  // Widen the window by one day on each side so month-boundary events are
  // captured regardless of the server timezone vs. the browser timezone.
  const { from, to } = scheduleMonthWindow(new Date());

  const res = await orgSchedule(auth0Id, { from: from.toISOString(), to: to.toISOString() }).catch(() => ({ events: [] }));

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium">Schedule</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Schedule</h1>
      <p className="mt-1 text-sm text-muted-foreground">Plan practices, matches, and events.</p>
      <div className="mt-6">
        <ScheduleClient auth0Id={auth0Id} initialEvents={res.events} />
      </div>
    </div>
  );
}