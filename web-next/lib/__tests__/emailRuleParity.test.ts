import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { EMAIL_RE, isEmail } from '@/lib/email'

// ── A validation rule duplicated across two tiers is a comment with a regex in it ─
//
// `EMAIL_RE` existed three times in web-next (the three invite surfaces) and once in the
// server, byte-identical. The server's is the authority — `server/src/routes/members.ts`
// rejects on it at `:94` and `:148`.
//
// The failure mode is quiet and one-directional: **the client validating more loosely than
// the server accepts input the API then 400s on**, so a coach types an address the form
// declares valid and the invite fails with no explanation. Nothing in either tier breaks;
// the two simply disagree, and only after one of them is edited.
//
// So the parity is asserted here rather than left to discipline. Reading across tiers is
// unusual for a web test, and that is the point: the alternative is a duplicated constant
// that looks correct in both places.

const SERVER_FILE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'server',
  'src',
  'routes',
  'members.ts',
)

describe('the email rule matches the server', () => {
  test('the client and server declare the SAME pattern', () => {
    const server = readFileSync(SERVER_FILE, 'utf8')
    const decl = /const EMAIL_RE = (\/.*\/)/.exec(server)
    expect(decl).not.toBeNull()
    // Source text, not a runtime import: the two tiers do not share a build, so comparing
    // the declared source is the only comparison available — and the only one that catches
    // the case where someone edits one side and forgets the other.
    expect(EMAIL_RE.source).toBe(decl![1].slice(1, -1))
  })

  test('the server file is where we think it is — this guard reads across tiers', () => {
    // If the server moved, this guard would silently start reading the wrong file and the
    // parity assertion above would pass vacuously against whatever it found there. So the
    // read is asserted to be of a file that really does declare the rule.
    const server = readFileSync(SERVER_FILE, 'utf8')
    expect(server).toContain('EMAIL_RE.test(email.trim())')
  })

  test('accepts ordinary addresses', () => {
    for (const ok of [
      'a@b.co',
      'grace.hopper@navy.mil',
      'first+tag@example.com',
      'x_y@sub.domain.example',
    ]) {
      expect(isEmail(ok)).toBe(true)
    }
  })

  test('trims before testing, as the server does', () => {
    // `server/src/routes/members.ts:94` tests `email.trim()`. A client that did not would
    // reject a value the server accepts — the opposite drift direction, and just as silent.
    expect(isEmail('  a@b.co  ')).toBe(true)
  })

  test('rejects the shapes the rule was written to reject', () => {
    for (const bad of ['', '   ', 'nope', 'a@b', 'a b@c.co', '@b.co', 'a@.co', 'a@b.']) {
      expect(isEmail(bad)).toBe(false)
    }
  })

  test('is permissive about the domain tail, deliberately', () => {
    // `a@b..c` passes this rule, and it also passes the server's — so this is a note about
    // the RULE rather than a gap in it. Recorded because the auditor flagged the
    // permissiveness, and the honest answer is that the server is equally permissive, so
    // "tighten it" is a change to BOTH tiers or neither.
    expect(isEmail('a@b..c')).toBe(true)
  })
})
