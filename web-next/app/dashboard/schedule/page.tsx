import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { orgSchedule } from "@/lib/org";
import { toISODate } from "@/lib/date";
import ScheduleClient from "@/components/org/ScheduleClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Schedule | CoachXYZ",
  description: "Plan practices, matches, and events.",
};

export default async function SchedulePage() {
  noStore();
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const auth0Id = session.user.sub;

  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  // Widen the window by one day on each side so month-boundary events are
  // captured regardless of the server timezone vs. the browser timezone.
  const from = new Date(`${toISODate(first)}T00:00:00`);
  from.setDate(from.getDate() - 1);
  const to = new Date(`${toISODate(lastDay)}T23:59:59`);
  to.setDate(to.getDate() + 1);

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