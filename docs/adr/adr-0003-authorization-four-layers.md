# ADR-0003: Authorization is four layers, and only the inner two say whose data

Status: Accepted
Date: 2026-09-27

## Context

`serviceGuard` admits any caller that presents the shared `SERVICE_TOKEN` plus a
`x-verified-auth0-id`, and for the three org-scoped path families
(`/api/org/`, `/api/email/`, `/api/auth/user/`) it additionally requires that
the caller be a **member** of the org named in the path. That is the whole of
what the guard decides: _this identity belongs to this org_.

From there a request passed through up to three more checks, and the codebase
did not agree on what each one meant. Three distinct gaps shipped as a result,
each invisible to a file-level reading because the file looked guarded:

- `POST /api/org/:id/reports/ai` was role-guarded **where it is mounted** in
  `index.ts`, which reads as covered. It passed `student_id` straight into the
  unscoped `buildReportContent`, so a team coach could have an AI report written
  about another team's player, carrying that player's attendance, series and
  analyses inside `report_context`.
- The entire `/api/auth/user/:id/*` family had neither a capability nor a scope
  check. It is keyed to the **org** (analysis rows are owned by the org, and the
  web passes `orgCtx.auth0Id`, not the session sub), so an unfiltered read
  there is org-wide, not "the caller's own data". A team coach's History page
  listed every player in the club, and the job-keyed routes handed over the
  detail, clips, chat transcript, and the rename / cancel / delete mutations.
- The findings routes validated `student_id` with `UUID_RE` and then read the
  row. A UUID is a shape, not a permission.

A fourth was the opposite of a gap. `routes/share.ts` compared the analysis
row's owning org against the **caller's own sub**. Since rows are org-owned,
that could only ever pass for the org owner: every coach was refused a share
link, and the same comparison blocked every revoke. The feature existed only for
the one caller it was not written for.

## Decision

Authorization is four layers, and only the last two can answer _whose_ data.

1. **Membership** — `serviceGuard` on an org-scoped path. Which identity belongs
   to which org.
2. **Role floor** — `orgRoleGuard([...])`, applied where a route is _mounted_ in
   `index.ts`. Which of the org's roles may reach the handler at all. It is a
   floor, not a decision, and it is deliberately declarative so a whole subtree
   can be floored in one place.
3. **Capability** — an in-handler `resolveCaller(...).can('<permission>')`. Which
   of those roles may perform _this action_. A missing capability is always 403.
4. **Scope** — an in-handler `visibleStudentIds` / `canSeeStudent` (or
   `accountJobScope` / `accountStudentReadable` for the account tree). Which
   _player's_ data the action may touch.

The rule that follows, and the one that actually matters: **a mount-time guard
is not a capability, and a capability is not a scope.** Auditing for this by
reading files rather than handler bodies will keep producing false negatives,
because a route guarded at mount looks covered in every grep.

Two decisions are specific to the account tree:

- **`/api/auth/user/:auth0Id/*` is org-keyed.** The `:auth0Id` is the org's own
  sub and the rows are the org's, so "self-scoped" is a false reading of the
  path. It needs the same scope seam as `/api/org/*`, reached through
  `accountJobScope` / `accountStudentReadable` (`lib/accountScope.ts`) for every
  job-keyed and student-keyed route respectively. Scoping `routes/org/*` is not
  scoping this family; they are separate files with separate histories, and the
  two were audited a year apart in the life of this codebase.
- **A scoped caller's reads keep their own unfiled uploads.** An analysis with no
  `student_id` belongs to whoever uploaded it. Dropping those rows would hide a
  coach's own History page, so the list filter is
  `student_id is null or student_id = any(<visible>)`. The accepted residual: a
  scoped caller also sees other people's unfiled uploads, which are attached to
  no player.

And one that is about the _kind_ of operation, not the layer:

- **A share token is a write.** Whoever holds the link reads that analysis with
  no login, so minting or revoking one is a question about publishing a player,
  not about viewing one. Both refuse 403, and the token is stamped with the org
  so the cross-org comparison is against the org in the path.

## Consequences

- A new org-scoped route needs layers 3 and 4 written by hand. That is the
  accepted cost: the checks are short, they read in place next to the data they
  protect, and each one can carry a comment explaining a deliberate status.
- Every `student_id` or job id in a handler is a place the scope can be skipped.
  `AGENTS.md` carries the rule and the trap names; the live smoke
  (`smokeOrgHttp.ts`) is what proves a bound id list is legal SQL, which no
  fixture can.
- The seam costs one extra indexed query per request for scoped callers only.
  Org-wide callers short-circuit before touching the store, so the owner path is
  unchanged in cost.
- Some sites answer 403 where the rule says a read should answer 404 — `wellness`
  deliberately, because the medical boundary above it has already narrowed the
  caller to roles that are org-wide by policy, so a 403 cannot be used to probe
  a roster. Those are documented in place rather than normalized, because the
  reason is the point.

## Alternatives rejected

- **One universal guard helper** (`requireCapability(auth0Id, request, perm, …)`
  returning a result union, applied to all 21 capability sites and the 19 scope
  sites. This is the change that looks most like KISS and is not. The 21
  capability blocks genuinely are uniform, but collapsing them saves about two
  lines per site while adding an indirection and a union to destructure, and it
  centralizes a policy `AGENTS.md` deliberately keeps visible at each route. The
  scope sites are worse: they _look_ identical and are not. `wellness` answers
  403 and says why, `attendance` refuses before the roster lookup, and
  `students/:id` checks a team rather than a student id. One helper for all
  three needs a knob per difference, which is a leaky abstraction wearing a
  helper's clothes.
- **Merge `accountScope.ts` into `org/scope.ts`.** One module answering "what
  may this caller see" reads better, and it is a cycle: `org/scope.ts` would
  need `getAnalysisStudentId` from `analyses.ts`, which already imports
  `uuidArrayLiteral` from `org/scope.ts`. The split is primitives
  (`org/scope.ts`) under a seam (`accountScope.ts`), which is the layering we
  want anyway.
- **One refusal status for everything.** Simplest to explain, and it turns every
  scope refusal into an existence oracle for ids.
- **Trust the role floor for reads and scope only the writes.** Halves the
  work, and leaves a team coach reading a whole club's History.
