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
  if (session) {
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
    }
    if (!orgs.length) {
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
