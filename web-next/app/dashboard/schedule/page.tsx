import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import { orgSchedule } from "@/lib/org";
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
  const month = today.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = new Date(`${today.getFullYear()}-${pad(month)}-01T00:00:00`).toISOString();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const to = new Date(
    `${today.getFullYear()}-${pad(month)}-${pad(lastDay)}T23:59:59`,
  ).toISOString();

  const res = await orgSchedule(auth0Id, { from, to }).catch(() => ({ events: [] }));

  return (
    <div className="p-8 lg:p-12 max-w-full">
      <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
        Organization
      </p>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
        Schedule
      </h1>

      {res.events.length === 0 && (
        <p className="mb-6 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
          No data connection yet — add events below.
        </p>
      )}

      <ScheduleClient auth0Id={auth0Id} initialEvents={res.events} />
    </div>
  );
}