import { auth0 } from "@/lib/auth0";
import { getUserProfile } from "@/lib/api";
import { redirect } from "next/navigation";
import Link from "next/link";
import UserAvatar from "@/components/UserAvatar";
import DashboardNav from "@/components/DashboardNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session;
  try {
    session = await auth0.getSession();
  } catch (error) {
    console.error("Failed to get auth session:", error);
    redirect("/auth/login");
  }

  if (!session) {
    redirect("/auth/login");
  }

  // Player accounts belong on /player, not the coach dashboard.
  try {
    const { user } = await getUserProfile(session.user.sub);
    if (user?.role === "player") redirect("/player");
  } catch (error) {
    console.error("Failed to resolve dashboard role:", error);
  }

  return (
    <div className="min-h-screen flex bg-[var(--background)]">
      {/* Sidebar — Auth0 style: white in light, near-black in dark, grouped nav */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Link href="/" className="mb-6 flex items-center gap-2 px-2">
            <span className="inline-flex size-6 items-center justify-center rounded bg-foreground text-background text-xs font-bold dark:bg-background dark:text-foreground">
              C
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">coach.xyz</span>
          </Link>

          <DashboardNav />
        </div>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted">
            <UserAvatar
              picture={session.user.picture}
              name={session.user.name}
              email={session.user.email}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground leading-none">
                {session.user.name || session.user.email}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {session.user.email}
              </p>
            </div>
          </div>
          <a
            href="/auth/logout"
            className="mt-2 flex items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Log Out
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto bg-[var(--background)]">{children}</main>
    </div>
  );
}
