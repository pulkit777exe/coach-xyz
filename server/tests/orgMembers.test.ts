import { afterEach, describe, expect, test } from "bun:test"
import {
  ORG_MEMBER_INVITE_ROLES,
  ORG_MEMBER_ROLES,
  ORG_MEMBER_ROLE_LABELS,
  ensureOrgOwner,
  getMemberRole,
  inviteOrgMember,
  listMembershipsForUser,
  removeOrgMember,
} from "../src/lib/orgMembers"
import { verifyOrgRole } from "../src/lib/serviceGuard"
import { upsertUser } from "../src/lib/supabaseHistory"

const hasDb = Boolean(process.env.DATABASE_URL)
const TOKEN = "test-service-token"

function setToken(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

afterEach(() => {
  setToken(undefined)
})

// Canonical org-member role vocabulary — values AND order must match
// web-next/lib/members.ts (pinned there by the web-side contract). The
// users.role enum (coach/player) is a separate vocabulary; do not merge them.
const CANONICAL = {
  orgMemberRoles: ["owner", "admin", "coach", "player"],
  inviteRoles: ["admin", "coach", "player"],
} as const

describe("org-member role vocabulary contract", () => {
  test("server values and order match the canonical list", () => {
    expect([...ORG_MEMBER_ROLES]).toEqual(CANONICAL.orgMemberRoles)
  })

  test("server exports exactly the canonical roles", () => {
    expect(new Set(ORG_MEMBER_ROLES)).toEqual(new Set(CANONICAL.orgMemberRoles))
  })

  test("labels cover every role exactly once", () => {
    expect(Object.keys(ORG_MEMBER_ROLE_LABELS).sort()).toEqual([...ORG_MEMBER_ROLES].sort())
  })

  test("invite roles are the canonical subset and never include the owner", () => {
    expect([...ORG_MEMBER_INVITE_ROLES]).toEqual(CANONICAL.inviteRoles)
    expect(ORG_MEMBER_INVITE_ROLES.includes("owner")).toBe(false)
  })
})

describe("verifyOrgRole decision table", () => {
  const OWNER = "auth0|owner"
  const ADMIN = "auth0|admin"
  const COACH = "auth0|coach"
  const OK = { ok: true } as const

  const member = (memberAuth0Id: string, role: string) => ({
    member_auth0_id: memberAuth0Id,
    role,
  })

  const members = () => [
    member(OWNER, "owner"),
    member(ADMIN, "admin"),
    member(COACH, "coach"),
  ]

  test("allows when the guard is disabled (no SERVICE_TOKEN), even for a stranger", () => {
    setToken(undefined)
    expect(verifyOrgRole({ verifiedAuth0Id: null, orgAuth0Id: OWNER, requiredRoles: ["owner"], members: null })).toEqual(OK)
  })

  test("rejects a missing verified identity", () => {
    setToken(TOKEN)
    const outcome = verifyOrgRole({
      verifiedAuth0Id: null,
      orgAuth0Id: OWNER,
      requiredRoles: ["owner"],
      members: members(),
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
    expect(outcome.body.code).toBe("FORBIDDEN")
  })

  test("rejects a caller with no member row and no owner path", () => {
    setToken(TOKEN)
    const outcome = verifyOrgRole({
      verifiedAuth0Id: "auth0|stranger",
      orgAuth0Id: OWNER,
      requiredRoles: ["owner"],
      members: members(),
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
  })

  test("rejects a member whose role is not in requiredRoles", () => {
    setToken(TOKEN)
    const outcome = verifyOrgRole({
      verifiedAuth0Id: COACH,
      orgAuth0Id: OWNER,
      requiredRoles: ["owner"],
      members: members(),
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
  })

  test("allows a member whose role is in requiredRoles", () => {
    setToken(TOKEN)
    expect(verifyOrgRole({ verifiedAuth0Id: ADMIN, orgAuth0Id: OWNER, requiredRoles: ["admin", "coach"], members: members() })).toEqual(OK)
  })

  test("allows the owner without a seeded org_members row when 'owner' is required", () => {
    setToken(TOKEN)
    expect(verifyOrgRole({ verifiedAuth0Id: OWNER, orgAuth0Id: OWNER, requiredRoles: ["owner"], members: [] })).toEqual(OK)
  })

  test("rejects the owner when 'owner' is not in requiredRoles", () => {
    setToken(TOKEN)
    const outcome = verifyOrgRole({
      verifiedAuth0Id: OWNER,
      orgAuth0Id: OWNER,
      requiredRoles: ["admin"],
      members: [],
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
  })

  test("owner-without-row still passes alongside member rows that omit them", () => {
    setToken(TOKEN)
    expect(
      verifyOrgRole({ verifiedAuth0Id: OWNER, orgAuth0Id: OWNER, requiredRoles: ["owner"], members: [member(ADMIN, "admin")] }),
    ).toEqual(OK)
  })

  test("falls closed (403) when membership is unavailable and the caller is not the owner", () => {
    setToken(TOKEN)
    const outcome = verifyOrgRole({
      verifiedAuth0Id: COACH,
      orgAuth0Id: OWNER,
      requiredRoles: ["coach"],
      members: null,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
  })

  test("owner-only routes match on the exact member_auth0_id, ignoring emailed-only rows", () => {
    setToken(TOKEN)
    const outcome = verifyOrgRole({
      verifiedAuth0Id: "auth0|future-staff",
      orgAuth0Id: OWNER,
      requiredRoles: ["owner"],
      members: [{ member_auth0_id: null, role: "admin" }],
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
  })
})

;(hasDb ? describe : describe.skip)("getMemberRole DB integration", () => {
  const ORG = `auth0|org-${Date.now()}`
  const MEMBER = `auth0|member-${Date.now()}`
  const EMAIL = `member-${Date.now()}@example.com`

  test("owner fast-path returns 'owner' without any DB setup", async () => {
    expect(await getMemberRole(ORG, ORG)).toBe("owner")
  })

  test("returns null for a caller with no membership", async () => {
    expect(await getMemberRole(ORG, MEMBER)).toBeNull()
  }, { timeout: 20000 })

  test("returns the active member's role after an invite", async () => {
    await upsertUser({
      sub: MEMBER,
      email: EMAIL,
      name: "Member Test",
      nickname: null,
      picture: null,
      email_verified: false,
    })
    const invited = await inviteOrgMember(ORG, ORG, {
      email: EMAIL,
      role: "coach",
    })
    expect(invited?.member_auth0_id).toBe(MEMBER)
    expect(await getMemberRole(ORG, MEMBER)).toBe("coach")
    await removeOrgMember(ORG, invited!.id)
  }, { timeout: 20000 })

  test("returns null after the member row is removed", async () => {
    await upsertUser({
      sub: MEMBER,
      email: EMAIL,
      name: "Member Test",
      nickname: null,
      picture: null,
      email_verified: false,
    })
    const invited = await inviteOrgMember(ORG, ORG, {
      email: EMAIL,
      role: "player",
    })
    await removeOrgMember(ORG, invited!.id)
    expect(await getMemberRole(ORG, MEMBER)).toBeNull()
  }, { timeout: 20000 })
})

;(hasDb ? describe : describe.skip)("listMembershipsForUser DB integration", () => {
  const ORG_A = `auth0|orgA-${Date.now()}`
  const ORG_B = `auth0|orgB-${Date.now()}`
  const OWNER_EMAIL_A = `ownerA-${Date.now()}@example.com`
  const MEMBER = `auth0|member-${Date.now()}`
  const MEMBER_EMAIL = `member-${Date.now()}@example.com`

  test("lists the caller as owner when they own the org", async () => {
    await upsertUser({
      sub: ORG_A,
      email: OWNER_EMAIL_A,
      name: "Owner A",
      nickname: null,
      picture: null,
      email_verified: false,
    })
    await ensureOrgOwner(ORG_A)
    const orgs = await listMembershipsForUser(ORG_A)
    const own = orgs.find((o) => o.org_auth0_id === ORG_A)
    expect(own?.role).toBe("owner")
  }, { timeout: 20000 })

  test("returns an empty list for someone with no memberships", async () => {
    const orgs = await listMembershipsForUser(`auth0|nobody-${Date.now()}`)
    expect(orgs).toEqual([])
  }, { timeout: 20000 })

  test("lists an invited member with the org as org_auth0_id", async () => {
    await upsertUser({
      sub: MEMBER,
      email: MEMBER_EMAIL,
      name: "Member Test",
      nickname: null,
      picture: null,
      email_verified: false,
    })
    await inviteOrgMember(ORG_B, ORG_B, { email: MEMBER_EMAIL, role: "coach" })
    const orgs = await listMembershipsForUser(MEMBER)
    const joined = orgs.find((o) => o.org_auth0_id === ORG_B)
    expect(joined?.role).toBe("coach")
  }, { timeout: 20000 })
})