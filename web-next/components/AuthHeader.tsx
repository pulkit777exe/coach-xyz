import { auth0 } from "@/lib/auth0";
import UserAvatar from "./UserAvatar";

export default async function AuthHeader() {
  const session = await auth0.getSession();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg)]/80 backdrop-blur-md border-b border-[var(--cream-05)]">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <a href="/" className="font-serif text-xl text-[var(--fg)]">
          coach.xyz
        </a>

        <nav className="flex items-center gap-4">
          {session ? (
            <>
              <a
                href="/dashboard"
                className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]"
              >
                Dashboard
              </a>
              <a
                href="/account"
                className="flex items-center gap-2 text-sm text-[var(--cream-40)] hover:text-[var(--fg)] transition-colors"
              >
                <UserAvatar
                  picture={session.user.picture}
                  name={session.user.name}
                  email={session.user.email}
                  size="sm"
                />
                <span>{session.user.name || session.user.email}</span>
              </a>
              <a
                href="/auth/logout"
                className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]"
              >
                Log Out
              </a>
            </>
          ) : (
            <>
              <a
                href="/auth/login"
                className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cream-40)] transition-colors hover:text-[var(--fg)]"
              >
                Log In
              </a>
              <a
                href="/auth/login?screen_hint=signup"
                className="border border-[var(--cream-10)] px-5 py-2 text-[0.65rem] uppercase tracking-[0.2em] text-[var(--fg)] transition-all hover:bg-[var(--fg)] hover:text-[var(--bg)]"
              >
                Sign Up
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
