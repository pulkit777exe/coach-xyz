# ADR-0004: Production stop lines (do not cross without a new ADR)

Status: Accepted
Date: 2026-09-29 (records decisions reached across Phases 5–7)

## Context

Three changes look like natural follow-ups to shipped work but each has a
cost that outweighs the benefit now, or needs a measurement / product
decision that does not exist yet. This ADR records them as stop lines so
future work starts from "decided", not "unknown". Crossing any of them
requires a new ADR, not a code comment.

## Decision

1. **No engine session-store merge.** `ADR-engine-scaling.md` designs the
   direction (re-resolve `session_token → keys` from durable storage, stop
   using process memory) but per-analysis throughput and cost were never
   measured, and the quota-limited Redis must not back the store. Merging
   the design without numbers risks a slower, more expensive analyze path
   that only pays off past single-instance scale. Revisit when timed
   `/scan` + `/analyze` runs for 1/3/5-minute 720p clips exist.

2. **Owner offboarding stays 400 — no ownership transfer.** Removing the
   org owner answers `400 The organization owner cannot be removed`
   (`orgOffboard.ts`). A transfer flow has to answer who may claim an
   ownerless org, what happens when the owner account is gone, and how a
   hostile member is kept from seizing the club through it — a privileged
   flow with abuse surface, not a status-code tweak. The custodian model
   (teams and history stay with the club) already preserves continuity.
   Revisit with a product-approved claim protocol, not before.

3. **Consent enforcement default stays `warn`.** `CONSENT_ENFORCEMENT`
   defaults to `warn` (log + audit, proceed); `enforce` answers 409
   `CONSENT_REQUIRED` (`consents.ts` — "changing the default is a product
   decision, not a code cleanup"). Flipping it would 409-block coaching
   flows for every pre-existing player never asked for consent, with no
   collection UX shipped. Per-org override stays available via env.
   Revisit after the consent-collection flow exists and existing clubs
   have had a migration window.

## Consequences

- Reviews that propose any of the three close with a link here.
- The engine stays single-instance; the owner row stays irremovable by
  API; consent gaps stay visible (warn + audit) rather than blocking.
- None of this is test-covered by design — a test would pin behavior
  that a future ADR is meant to change freely. The matrix pins the
  surrounding 403/404/409 shapes instead.
