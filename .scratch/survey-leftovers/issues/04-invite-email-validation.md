# mintInvite email-shape validation lives only at call sites (unconfirmed)

Status: needs-triage

## What

`server/src/lib/invites.ts` `mintInvite` trims/lowercases but does no
email-shape validation; validity depends on each route applying
`EMAIL_RE` (verified on the direct-invite path, `members.ts:69`; the
token-invite path was only partially read). If any caller skips it,
malformed emails get stored and mailed.

## Fix options

- Validate inside `mintInvite` (single choke point) and confirm with a
  unit test feeding it garbage.
- Confirm-then-close if every caller already validates.

## Context

Survey suspicion S3, 2026-09-30.
