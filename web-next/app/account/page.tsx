import type { Metadata } from "next";
import Link from "next/link";
import { auth0 } from "@/lib/auth0";
import { syncUser } from "@/lib/api";
import { redirect } from "next/navigation";
import UserAvatar from "@/components/UserAvatar";

export const metadata: Metadata = {
  title: "Account | CoachXYZ",
  description: "Manage your CoachXYZ account and profile.",
};

/** Parse the Auth0 `sub` claim to a human-readable provider label.
 *  Examples: "google-oauth2|123" → "Google", "github|456" → "GitHub",
 *  "auth0|789" → "Email / Password"
 */
function parseProvider(sub: string): string {
  const prefix = sub.split("|")[0] ?? ""
  if (prefix === "google-oauth2") return "Google"
  if (prefix === "github") return "GitHub"
  if (prefix === "auth0") return "Email / Password"
  if (prefix === "windowslive") return "Microsoft"
  if (prefix === "facebook") return "Facebook"
  return prefix || "Unknown"
}

export default async function AccountPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login");
  }

  const provider = parseProvider(session.user.sub)

  let user = null;
  let syncError = null;
  try {
    const result = await syncUser({
      sub: session.user.sub,
      email: session.user.email,
      name: session.user.name,
      nickname: session.user.nickname,
      picture: session.user.picture,
      email_verified: session.user.email_verified,
    });
    user = result.user;
  } catch (error) {
    console.error("Failed to sync user with backend:", error);
    syncError = error instanceof Error ? error.message : "Failed to sync profile data";
  }

  return (
    <div className="min-h-screen pb-12 px-6 lg:px-12">
      <div className="max-w-2xl mx-auto pt-8">
        <p className="mb-4 text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
          Settings
        </p>
        <h1 className="font-serif text-4xl leading-none text-(--fg) mb-12 sm:text-5xl">
          Account
        </h1>

        {/* Sync Error Banner */}
        {syncError && (
          <div className="border border-(--red) p-4 mb-8">
            <p className="text-sm text-(--red)">Failed to sync profile data. Some information may be outdated.</p>
          </div>
        )}

        {/* Profile Card */}
        <div className="border border-(--cream-10) p-8 mb-8">
          <p className="mb-6 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Profile
          </p>

          <div className="flex items-center gap-5 mb-8">
            <UserAvatar
              picture={session.user.picture}
              name={session.user.name}
              email={session.user.email}
              size="lg"
            />
            <div>
              <p className="font-serif text-2xl text-(--fg)">
                {session.user.name || "No name"}
              </p>
              <p className="mt-1 text-sm text-(--cream-40)">{session.user.email}</p>
            </div>
          </div>

          <div className="space-y-0">
            {[
              { label: "Email", value: session.user.email },
              { label: "Name", value: session.user.name || "—" },
              { label: "Nickname", value: session.user.nickname || "—" },
              { label: "Signed in with", value: provider },
              {
                label: "Email Verified",
                value: session.user.email_verified ? "Yes" : "No",
              },
              { label: "User ID", value: session.user.sub, mono: true },
            ].map((row, i) => (
              <div
                key={row.label}
                className={`flex justify-between items-baseline py-3 ${
                  i < 5 ? "border-b border-(--cream-05)" : ""
                }`}
              >
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40)">
                  {row.label}
                </span>
                <span
                  className={`text-sm text-(--fg) ${row.mono ? "font-mono" : ""}`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Database Record */}
        {user && (
          <div className="border border-(--cream-10) p-8 mb-8">
            <p className="mb-6 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
              Database Record
            </p>
            <div className="space-y-0">
              <div className="flex justify-between items-baseline py-3 border-b border-(--cream-05)">
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40)">
                  Created
                </span>
                <span className="text-sm text-(--fg)">
                  {new Date(user.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-baseline py-3">
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40)">
                  Last Updated
                </span>
                <span className="text-sm text-(--fg)">
                  {new Date(user.updated_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <Link
            href="/"
            className="border border-(--cream-10) px-6 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-(--fg) transition-all hover:bg-(--fg) hover:text-(--bg)"
          >
            Back to Home
          </Link>
          <a
            href="/auth/logout"
            className="px-6 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-(--red) border border-(--red) transition-all hover:bg-(--red) hover:text-(--bg)"
          >
            Log Out
          </a>
        </div>
      </div>
    </div>
  );
}
