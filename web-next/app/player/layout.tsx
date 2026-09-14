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
    <div className="min-h-screen flex">
      <aside className="w-64 border-r border-(--cream-05) p-6 flex flex-col">
        <Link href="/player" className="font-serif text-xl text-(--fg) mb-10">
          player.xyz
        </Link>

        <nav className="space-y-1">
          <Link
            href="/player"
            className="block px-3 py-2 text-sm text-(--fg) hover:bg-(--cream-05) transition-colors"
          >
            My Hub
          </Link>
        </nav>

        <div className="border-t border-(--cream-05) pt-4 mt-auto">
          <div className="flex items-center gap-3">
            <UserAvatar
              picture={session.user.picture}
              name={session.user.name}
              email={session.user.email}
              size="md"
            />
            <div className="min-w-0">
              <p className="text-sm text-(--fg) truncate">
                {session.user.name || session.user.email}
              </p>
              <p className="text-[0.6rem] text-(--cream-40) truncate">
                {session.user.email}
              </p>
            </div>
          </div>
          <a
            href="/auth/logout"
            className="mt-3 block text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
          >
            Log Out
          </a>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}