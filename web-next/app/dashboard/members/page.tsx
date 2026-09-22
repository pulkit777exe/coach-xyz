import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getOrgContext, orgInvites, orgMembers } from "@/lib/serverData";
import MembersSection from "@/components/org/MembersSection";
import InvitesClient from "@/components/org/InvitesClient";
import { unstable_noStore as noStore } from "next/cache";

export const metadata: Metadata = {
  title: "Members | CoachXYZ",
  description: "Manage staff, roles, and invitations.",
};

export default async function MembersPage() {
  noStore();
  const session = await getSession();
  if (!session) redirect("/auth/login");
  const { auth0Id } = await getOrgContext();

  const [membersRes, invitesRes] = await Promise.all([
    orgMembers(auth0Id),
    orgInvites(auth0Id).catch(() => ({ invites: [] })),
  ]);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <span>Organizations</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground">Members</span>
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-foreground">Members</h1>
      <p className="mt-1 text-sm text-muted-foreground">Staff roles and single-use invitations.</p>

      <div className="mt-6 space-y-6">
        <MembersSection auth0Id={auth0Id} initialData={membersRes} />
        <InvitesClient auth0Id={auth0Id} initialInvites={invitesRes.invites} />
      </div>
    </div>
  );
}
