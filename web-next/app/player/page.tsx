import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { getUserProfile } from "@/lib/serverData";
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import PlayerHub from "@/components/player/PlayerHub";

export const metadata: Metadata = {
  title: "My Hub | CoachXYZ",
  description: "Your attendance, schedule, performance and reports.",
};

export default async function PlayerPage() {
  noStore();
  const session = await getSession();
  if (!session) redirect("/auth/login");

  let role: "coach" | "player" | null = null;
  try {
    const { user } = await getUserProfile(session.user.sub);
    role = user?.role ?? null;
  } catch (error) {
    console.error("Failed to resolve player role:", error);
  }

  if (role === "coach") redirect("/dashboard");

  return <PlayerHub />;
}