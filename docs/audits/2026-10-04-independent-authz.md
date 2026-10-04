# Independent authorization audit — 2026-10-04

Six independent auditors, each given ~20 routes, derived the correct HTTP status
per role **from source only**. They were explicitly forbidden from reading
`server/tests/authMatrixPolicy.ts`, `AGENTS.md`, and `docs/`, because the point was
to compare an independent derivation against the table — a table written from
observed behaviour will agree with observed behaviour by construction.

**Caveat, stated because it weakens the method:** one auditor reported that
`AGENTS.md` was injected into its system prompt by the harness before it started.
It did not open the file and re-derived from `server/src/**`, but "blind" is not a
claim that can be made for that slice without qualification.

## Method note — the framework fact that decided many answers

Every auditor independently re-derived, most of them by experiment rather than
inference, that the app-level role guards in `app.ts` **do not fire**:

```ts
.use(orgRoute.use(orgRoleGuard([...])))     // barrel already holds its routes → 200
.use(emailRoute.use(orgRoleGuard([...])))   // same shape                        → 200
```

A `scoped` hook added to an instance *after* its child routes are composed never
reaches them. The shapes that DO fire are a sub-instance registered before its own
routes (`settings.ts`, `members.ts`, `teams.ts`, `share.ts`) or a mount on the root
before the child.

`AGENTS.md` already recorded this. What is new is the consequence: **several table
rows were recording the mount list's intent rather than the composed app's
behaviour**, and five auditors each read that list, derived a role floor from it,
and had to be corrected by experiment.

## Fixed this round

| # | Finding | Fix | Mutation-checked |
|---|---|---|---|
| 1 | `POST /api/me/notifications/:id/read` — `params.id` reached a `uuid` primary key unvalidated, so a malformed id answered **500**, not 400 | `pickUuid` at the boundary | yes (14 pass / 1 fail) |
| 2 | `GET /api/me/reports/:id` — same shape, same 500 | `pickUuid`, placed *before* the linked-player branch | yes (14 pass / 1 fail) |
| 3 | `PUT /api/org/:auth0Id/analyses/:jobId/student` — an **unscoped** `getStudent` existence check ran before the visibility check, so a team coach learned "that uuid is a real player in this org" from 403-vs-404 | existence read narrowed by `caller.studentScope` | yes (source guard) |
| 4 | `GET /api/me/notifications` declared **twice** in the policy table — `MATRIX.find` returns the first, so the second copy's 11 cases never ran, invisibly | duplicate removed + two guards | yes (0 pass / 1 fail) |

Findings 1 and 2 existed *because the table had no malformed-id variant for those
routes* while its own header declares "malformed ids → 400" as a repo-wide
convention. Both variants are now pinned (22 new cases).

Finding 4 was found by noticing the probe reported **1496** cases where the table's
own arithmetic said **1507** — a gap of exactly one variant's worth. That
mismatch is now asserted, so a skipped row cannot hide again.

## Found, reported, deliberately NOT fixed

### `POST /api/email/:auth0Id/report` — `analyst` may mail any report to any address

The chain is real: `app.ts`'s floor excludes `analyst`, but it never fires;
`emailGuard` requires `report.create`, which `analyst` **holds**; the report is read
through an unscoped `getReport`; and the recipient comes from the request body.

**It was left alone on purpose.** `tests/emailRouteGuards.test.ts` asserts
`analyst=200` with stated reasoning — an analyst is an org-wide reader that can
already fetch every report through `GET /api/org/:auth0Id/reports/:id`, so mailing
one escalates nothing. That reasoning holds. What is genuinely undecided is whether
*read* should imply *egress to an arbitrary address*, which is a product question,
not an auditor's. The contradiction is now recorded at the mount site
(`EMAIL_TREE_ROLES_NOT_ENFORCED`) and on the table row, so neither side reads as
settled.

### The inert `app.ts:150` org floor — root cause of most `player=200` rows

`player` is deliberately excluded from the org tree everywhere else in the code
(`permissions.ts`, `settings.ts`'s own comment) yet reaches every handler, because
membership is the only live mount gate. Routes with no in-handler capability check
therefore answer **200** to a role the design says should be refused:

- `GET /api/org/:auth0Id/seasons` — populated, not empty (`listSeasons` keeps a
  match-less season org-visible)
- `GET /api/org/:auth0Id/schedule` — **every club-level fixture**; the scope filter
  degenerates to `team_id is null` for an empty team list
- `GET /api/org/:auth0Id/members` — the full roster **including every member's
  email**, because `members.ts` uses the whole `ORG_MEMBER_ROLES` vocabulary as its
  floor while `teams.ts` enumerates roles explicitly
- `GET /api/org/:auth0Id/settings` — contradicts its own module comment
- `GET /api/org/:auth0Id/plans`, `/objectives`, `/reports`, `/search`,
  `/students/sports`, `/attendance` — 200 with an empty body

Not fixed, because the fix is one line per route *or* making the mount live, and
making it live flips a large number of pinned cells at once. That is a change that
needs its own audit round and an explicit decision about what `player` should see
of an org, not a drive-by during a review.

### Other findings recorded, not fixed

- `GET /api/org/:auth0Id/teams/:teamId/members` — a **read** answers 403 where every
  sibling read answers 404 for a hidden target
- `DELETE /api/auth/user/:auth0Id/analyses/:jobId` — destructive, gated only by
  scope; no capability question is asked, while its sibling
  `.../clips/:clipId` correctly asks `finding.review` first
- `GET /api/auth/user/:auth0Id` — no capability and no scope; returns the whole
  `users` row for whatever account the path names
- `GET /api/org/:auth0Id/students/:id` — no capability check, unlike `teams.ts:76`
  and `aiReports.ts:495`; currently safe only because the scope seam answers 404
- **Fixture-dependent expectations.** Several rows flip on body shape rather than
  on a rule: `POST /matches`, `DELETE /matches/:id`, `DELETE /plans/:id`,
  `POST /objectives` and `POST /schedule` all answer 403 instead of 2xx for team
  staff when the body names no team. A table recording 2xx there is recording the
  fixture, not the rule.
- `POST /api/email/:auth0Id/invite` — a 200 is unreachable in a live environment
  (501 without `RESEND_API_KEY`, 502 when the provider rejects)
- `POST /api/me/invites/accept` — status is a function of the fixture token's email,
  not of the role; only the email-matching identity gets 200
- `PUT /api/org/:auth0Id/performance/:id` — body validation (400) precedes the
  scope check, inverting the convention its siblings follow

## What this changed about the method

The audit was worth running: it found four real defects and one design
contradiction, none of which several rounds of my own reading had surfaced. It also
reproduced, independently and five times over, a fact already in `AGENTS.md` — which
is the more useful result, because five independent derivations converging on a
known-but-unacted-on defect says the ledger entry was written down and not treated
as a work item.

It is still not independence. Every auditor shares my framing, my model of the
product, and (for one) my own `AGENTS.md` in its prompt. What it removes is my
*memory* of why I concluded what I concluded — not my bias about what to look for.