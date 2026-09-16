import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";
import Link from "next/link";
import UserAvatar from "@/components/UserAvatar";

export default async function PlayerLayout({
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

  return (
    <div className="min-h-screen flex bg-[var(--background)]">
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Link href="/player" className="mb-6 flex items-center gap-2 px-2">
            <span className="inline-flex size-6 items-center justify-center rounded bg-foreground text-background text-xs font-bold dark:bg-background dark:text-foreground">
              P
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">player.xyz</span>
          </Link>
          <nav className="flex flex-col gap-1">
            <Link
              href="/player"
              className="flex items-center gap-2.5 rounded-md bg-primary/10 px-2.5 py-2 text-sm font-medium text-primary dark:bg-primary/20 dark:text-primary"
            >
              My Hub
            </Link>
          </nav>
        </div>
        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <UserAvatar picture={session.user.picture} name={session.user.name} email={session.user.email} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-none text-foreground">{session.user.name || session.user.email}</p>
              <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
            </div>
          </div>
          <a href="/auth/logout" className="mt-2 flex items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Log Out
          </a>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto bg-[var(--background)]">{children}</main>
    </div>
  );
}