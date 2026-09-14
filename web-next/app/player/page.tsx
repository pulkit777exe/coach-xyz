import type { Metadata } from "next";
import { auth0 } from "@/lib/auth0";
import { getUserProfile } from "@/lib/api";
import { redirect } from "next/navigation";
import PlayerHub from "@/components/player/PlayerHub";

export const metadata: Metadata = {
  title: "My Hub | CoachXYZ",
  description: "Your attendance, schedule, performance and reports.",
};

export default async function PlayerPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  let role: "coach" | "player" | null = null;
  try {
    const { user } = await getUserProfile(session.user.sub);
    role = user?.role ?? null;
  } catch (error) {
    console.error("Failed to resolve player role:", error);
  }

  if (role === "coach") redirect("/dashboard");

  return <PlayerHub auth0Id={session.user.sub} />;
}