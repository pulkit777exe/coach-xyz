/**
 * The email shape this app accepts.
 *
 * ONE copy, replacing three identical `const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`
 * declarations across the three invite surfaces (`InvitePlayersDialog`, `MembersSection`,
 * `InvitesClient`).
 *
 * **It must stay byte-identical to the server's rule**, which is the authority:
 * `server/src/routes/members.ts:29` declares the same literal and rejects on it. A client
 * that validates more loosely than the server accepts input the API then 400s on, and the
 * coach sees an unexplained failure on an invite they were told was valid. A client that
 * validates more strictly blocks addresses the server would have taken.
 *
 * `lib/__tests__/emailRuleParity.test.ts` reads the server file and fails if the two drift,
 * because a duplicated constant in two tiers is a comment with a regex in it.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Test a value against the shared rule. Trims first, as the server does. */
export const isEmail = (value: string): boolean => EMAIL_RE.test(value.trim())
