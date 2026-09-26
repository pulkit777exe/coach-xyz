# ADR-0002: Roster scope has two tiers, not one

Status: Accepted
Date: 2026-09-26

## Context

`resolveStudentScope` narrowed **every** non-owner to their assigned teams, and only the
students route honoured it. Attendance, schedule, reports, performance, objectives, plans,
wellness, the overview rollup and the org search were all org-wide, so a coach assigned to
one team could read every team's data through the API while the roster list looked correctly
scoped. Several writes were gated only by a capability (`player.manage`, `attendance.write`),
which says _a role_ may reshape a roster, not _whose_ roster — so an id was enough to reach a
student on another team.

Applying the documented rule uniformly would have been the obvious fix, and it is wrong.
The rule was written when "non-owner" was treated as one kind of person. The org has two:

- **Team staff** — head coach, assistant coach, legacy `coach`. They run sessions for the
  teams they are assigned to. Scoping them to their teams is exactly right.
- **Org staff** — `analyst` and `medical`. Read-only specialists who analyse the whole club,
  and who are rarely given a team membership at all. Under the uniform rule they resolved to
  an empty scope, so the app was blank for them: the roster page, attendance, everything.
  A read-only role seeing strictly less than the coaches it observes is the wrong default.

## Decision

Split the scope by staff kind rather than by "is this the owner".

1. `resolveStudentScope` returns `{ all: true }` for `owner`, `admin`, **`analyst`**,
   **`medical`**; `{ all: false, teamIds }` for `head_coach`, `assistant_coach`, `coach`.
   An unassigned coach still sees nothing — that is the honest answer for managing no team,
   and collapsing it to org-wide would be the dangerous direction to err in.
2. `canAccessTeam` moves with it. Org staff reach every team; gating them by membership
   would hide the very data their scope allows, and `GET /teams` filtering on raw membership
   ids (rather than through `canAccessTeam`) would have shown them an empty list.
3. Capability is not scope. Every read and write keyed to a `student_id` also asks
   `visibleStudentIds(orgAuth0Id, caller.studentScope)` (`lib/org/scope.ts`) — `null` for
   org-wide, a list for a scoped caller, `[]` for none — and write paths gate on
   `canSeeStudent` before touching the store. `null` and `[]` are deliberately distinct.
4. Refusals for an out-of-scope **target** are 404, not 403, matching the roster read that
   already did this: a distinct status for "exists but is not yours" turns any student id
   into a membership oracle. A missing **capability** still returns 403, since that leaks
   only the caller's own role.
5. `schedule_events` and `seasons` carry no `team_id` and no `student_id`. They stay
   org-wide deliberately. Narrowing them would mean hiding the fixture list from the coaches
   who need it, which is worse than the exposure.

## Consequences

- **This widens `analyst` and `medical`**, including on the students route where they
  previously resolved to an empty scope. They now see the full roster, which is the intent,
  and is a deliberate change rather than a side effect.
- Any new student-keyed read or write must apply the scope. A route that resolves a
  `student_id` without asking the seam reintroduces the bug this closes; the
  floor-is-membership rule in `AGENTS.md` covers capability, and the
  capability-is-not-scope rule covers this.
- Per-request the seam costs one extra indexed query for scoped callers only; org-wide
  callers short-circuit before touching the store.

## Alternatives rejected

- **Uniform team scoping for all non-owners.** Maximum privacy on paper, and it renders the
  app unusable for any analyst or medical user in an org that does not assign them to teams.
  Rejected as a worse failure mode than the exposure it prevents.
- **Capability-only (leave scope as-is).** No code change, but the exposure is real and
  `team.read` in the matrix already implies scoped reads. Rejected as documenting a bug.
- **Per-user scoping overrides.** A member flag choosing their own visibility. Rejected: it
  makes the readable set depend on a setting, so every read path would need to resolve it,
  and a mis-set flag would widen access rather than narrow it.
