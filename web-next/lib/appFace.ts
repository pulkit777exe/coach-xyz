// Which app face a signed-in viewer belongs on: the coach dashboard or the
// player hub — decided in ONE place, because three call sites used to decide
// it independently and disagreed.
//
// WHY TWO VOCABULARIES EXIST. `CONTEXT.md` states it: account-level
// `users.role` (`'coach' | 'player'`) is *separate* from membership roles, and
// it flips to `player` when a signup email auto-links a `students` row
// (`server/src/lib/users.ts` → `linkPlayerToStudent`). It is written exactly
// once, at account creation — nothing ever writes `'coach'` back — so it
// records how the account was BORN, not what the person may do today. The
// membership vocabulary (`org_members.role`, `owner | … | player`) is live per
// org and is what every server authorization decision reads.
//
// THE DEFECT THAT MADE THIS NECESSARY: a person enrolled as a student signs
// up (account flips to `player`), is later invited to a club as `head_coach`,
// and stays locked out of the coach app — no org pill, no Dashboard link
// (`AuthHeader`), and `/dashboard` bounced them to `/player`
// (`app/dashboard/layout.tsx`) — because each gate read the ACCOUNT field
// alone.
//
// THE RULE — one direction only:
//   • the account field can keep you on the PLAYER face, and
//   • a live staff membership anywhere (role ≠ `player`, in an org that is not
//     the owner-of-self row) PROMOTES you to the DASHBOARD face.
// Membership never demotes: an account that says `coach` stays on the coach
// face even when its only membership is `player` — the seeded player personas
// are exactly that crossing, and `app/dashboard/page.tsx` renders them
// `PlayerHome` inside the dashboard by design.
//
// THE OWNER-OF-SELF EXCLUSION is load-bearing: `listMembershipsForUser`
// lazily seeds an `owner` row for EVERY account, keyed by the caller's own
// sub. Counting it as staff would promote every membershipless player straight
// into the coach dashboard. The residual it deliberately does not solve: an
// account-`player` user who comes to own a real club (orgs are keyed by their
// sub, so it IS their own-sub row) stays on the player face until they hold a
// staff membership somewhere — they were already locked out of building one,
// so this is not a regression, and guessing at it would need a product ruling.
//
// FAIL-OPEN, both halves: an unresolved account role (`null`, a failed profile
// read) means dashboard/full topbar, and an unresolved `ownSub` counts rows as
// staff rather than silently keeping the player face. Gating never locks out
// unresolved context — the documented intent in `components/AuthHeader.tsx`.

export type AppFace = 'dashboard' | 'player'

export type AppFaceInput = {
  /** Account-level `users.role` (`'coach' | 'player'`); null when unresolved. */
  accountRole: string | null | undefined
  /** Active memberships — the `/api/me/orgs` rows (`org_auth0_id` + `role`). */
  orgs: ReadonlyArray<{ org_auth0_id: string; role: string }>
  /** The caller's own sub — identifies the auto-seeded owner-of-self row. */
  ownSub: string | null | undefined
}

export function appFace({ accountRole, orgs, ownSub }: AppFaceInput): AppFace {
  if (accountRole !== 'player') return 'dashboard'
  const holdsStaffMembership = orgs.some(
    (o) => o.role !== 'player' && (ownSub == null || o.org_auth0_id !== ownSub),
  )
  return holdsStaffMembership ? 'dashboard' : 'player'
}
