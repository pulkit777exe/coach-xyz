# ADR: Org Lifecycle (custodian model, archive, active org)

Status: accepted. Date: 2026-09-28.

## 1. Custodian model (coach leave / removal)

- Data stays with the org. Nothing cascades on offboard.
- The leaver's `team_memberships` rows for this org's teams are deleted; an optional named successor inherits those team rows (`ON CONFLICT DO NOTHING`).
- No successor named: the org owner acts as custodian. Owners/admins are org-wide (`resolveStudentScope` all:true), so no team rows are written for them.
- The `org_members` row is hard-deleted last, in the same transaction (fail-closed). No soft flag: every membership lookup would otherwise filter status forever.
- Owner offboarding is refused with 400. No ownership transfer (non-goal).
- Players cannot self-leave (`POST /api/me/orgs/:org/leave` 400 for `player`); players are managed by their coach.
- Notifications are best-effort: self-leave notifies the org owner; owner-removal with successor notifies the successor. Audit (`member.removed`, per-team `team.member_removed`/`team.member_added`) is best-effort and never fails the action.

## 2. Archive semantics (students)

- `'archived'` is a status, not a delete. Roster list excludes archived by default; `include_archived=1` opts in; an explicit `status` filter wins.
- Scope (`visibleStudentIds`) and by-id reads still include archived students, so history, links and reports keep resolving.
- Archive is an explicit roster action only. Leaving, transferring, or offboarding never archives.
- `deleteStudent` is transactional erasure of private rows (wellness, objectives, plans, team rows), with analyses and player events unlinked (`student_id = null`) so club history survives. `attendance`, `performance_metrics`, `player_consents` cascade; `reports.student_id` sets null.

## 3. Active-org rule

- One source of truth on the web (`useActiveOrg` or equivalent) backed by a server-readable `active_org` cookie so RSC and client agree. The cookie is a preference only; every request is authorized server-side against membership.
- Resolution: persisted choice (validated against `GET /api/me/orgs`) → org just joined via invite accept → user's own org. Reset to own org after leaving.
- Investigation findings (2026-09-28):
  - Today the current org is `resolveOrgContext` over the `coach_org` cookie → membership elsewhere → owned → `orgs[0]` → self (`web-next/lib/orgContext.ts:41-55`, `lib/serverData.ts:144-165`). No localStorage. Home page (`app/page.tsx:8-12`) passes the raw session sub with no org context.
  - `GET /api/me/orgs` consumers: `lib/serverData.ts` (`getMyOrgsCached`, `getOrgContext`), `app/dashboard/layout.tsx`, `app/dashboard/org/page.tsx`, `components/org/SettingsClient.tsx`, `components/AuthHeader.tsx`.
  - `usePipeline` has one caller (`AppClient`), which has one caller (`app/page.tsx`). Both `startAnalysis` callsites pass only the session sub; the web never sends an org id.
  - Server gap: `routes/analyze.ts:84` resolves the org as `memberships[0] ?? owner`, so a multi-org coach's quota and row ownership can land on the wrong org. Fix (Phase 3): accept validated `org_auth0_id`, require active membership with `analysis.create`, persist under the org key with `requested_by` = coach and `owner_ids` including both.
  - `listMembershipsForUser` seeds self-owner and sorts owners first, so `memberships[0]` is the personal workspace. The active-org rule above replaces `memberships[0]` reads everywhere.

## 4. Consent enforcement

- `CONSENT_ENFORCEMENT=off|warn|enforce`, default `warn`. `warn` logs + audits; `enforce` rejects 409 `CONSENT_REQUIRED`. Medical-role reads unaffected. STOP before changing the default.
