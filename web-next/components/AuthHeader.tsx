import { getSession } from '@/lib/session'
import { getMyOrgsCached, getOrgContext, getUserProfile } from '@/lib/serverData'
import type { MyOrg } from '@/lib/meApi'
import HeaderClient from './HeaderClient'

export default async function AuthHeader() {
  const session = await getSession()
  const user = session?.user
    ? {
        sub: session.user.sub,
        picture: session.user.picture ?? null,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }
    : null

  // Org switcher data for the topbar pill — per-request cached (the same
  // getMyOrgsCached fetch backs the dashboard), so signed-in users pay for it
  // once per request. Signed-out visits skip the fetch entirely. If the fetch
  // fails or comes back empty (fresh account before the owner-of-self seed),
  // fall back to the user's own workspace so the org context never vanishes.
  let orgs: MyOrg[] = []
  let currentOrgId: string | null = null
  // Account role steers the player variant of the app topbar: players get
  // neither the org pill (their only "org" is the owner-of-self workspace the
  // seed creates — labeled Owner, nothing to switch) nor the Dashboard CTA
  // (a surface /dashboard bounces them out of). Failures leave role null →
  // full topbar: gating never locks out unresolved context.
  let role: string | null = null
  /** Did the org read FAIL, as opposed to legitimately returning none? See below. */
  let orgsFailed = false
  if (session) {
    // `orgsFailed` is the whole point of this change. Only the profile fetch had a
    // handler, so a rejection from `getOrgContext()` or `getMyOrgsCached()` — a transient
    // 5xx, a timeout — dropped the whole `Promise.all` into the catch with `orgs` still
    // `[]`. And `!orgs.length` cannot tell that apart from a genuine new account, so the
    // fallback below ran and FABRICATED an org: the coach's own sub, with `role: 'owner'`
    // and their own name as the label. An invited head coach who hit a Neon blip saw a
    // workspace pill reading their own name marked "owner", in the single-org face with
    // no switcher — and since every dashboard page independently falls back to
    // owner-of-self, the whole app rendered as an empty personal workspace.
    //
    // A failure and an absence produce identical props otherwise, so the only honest fix
    // is to carry the difference. `role` deliberately stays null on failure: `isPlayer`
    // derives from it, and a null means the full topbar, which is the documented
    // fail-open intent below. Fabricating a role to look tidy would be the same lie one
    // level up.
    try {
      const [ctx, myOrgs, profile] = await Promise.all([
        getOrgContext(),
        getMyOrgsCached(),
        getUserProfile(session.user.sub).catch((error) => {
          console.error('Failed to resolve header role:', error)
          return null
        }),
      ])
      orgs = myOrgs.orgs
      currentOrgId = ctx.auth0Id
      role = profile?.user?.role ?? null
    } catch (error) {
      console.error('Failed to resolve org switcher:', error)
      orgsFailed = true
    }
    if (!orgsFailed && !orgs.length) {
      orgs = [
        {
          org_auth0_id: session.user.sub,
          role: 'owner',
          display_name: session.user.name ?? 'Your workspace',
        },
      ]
      currentOrgId = session.user.sub
    }
  }

  return <HeaderClient user={user} orgs={orgs} currentOrgId={currentOrgId} role={role} />
}
