import { auth0 } from "@/lib/auth0";
import { syncUser } from "@/lib/api";
import { redirect } from "next/navigation";
import UserAvatar from "@/components/UserAvatar";

export default async function AccountPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login");
  }

  let user = null;
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
              {
                label: "Email Verified",
                value: session.user.email_verified ? "Yes" : "No",
              },
              { label: "User ID", value: session.user.sub, mono: true },
            ].map((row, i) => (
              <div
                key={row.label}
                className={`flex justify-between items-baseline py-3 ${
                  i < 4 ? "border-b border-(--cream-05)" : ""
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
          <a
            href="/"
            className="border border-(--cream-10) px-6 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-(--fg) transition-all hover:bg-(--fg) hover:text-(--bg)"
          >
            Back to Home
          </a>
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
