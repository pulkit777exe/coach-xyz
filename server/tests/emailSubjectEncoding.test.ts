import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { lastJsonLine, runProbeProcess } from './spawnProbe'

// ── Plain text must not carry HTML entities — proved at the send boundary ────
//
// `mailerTemplates.test.ts` tests the templates in isolation, which pins the
// INJECTION half. It cannot pin the half that actually reached users, because
// that bug lived in the CALLER: `routes/email.ts` escaped every value before
// handing it to a template that used the same value in three places — the html
// body, the plain-text `text` field, and the `subject`. So a coach named
// `Tom & Jerry` produced the subject line
//
//   "Tom &amp; Jerry invited you to Tom &amp; Jerry's Team on CoachXYZ"
//
// which is wrong in a mail client, in a notification list, and in any search
// over sent mail. And it was invisible to the whole suite, because
// `emailRouteGuardsProbe.ts` replaces the mailer module wholesale: every
// template is a constant stub and `sendEmail` records only `to` and `html`.
//
// So this asserts on what Resend would actually have received. The probe runs
// the real route, the real templates and the real `sendEmail`, and replaces
// only `fetch`. Nothing between the request body and the outbound JSON is
// stubbed, which is the whole point: the defect was in the seam, so the test has
// to cross the seam.

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'emailTemplateProbe.ts')

/** Hostile as markup, visibly wrong once encoded: the payload must survive. */
const HOSTILE = 'Tom & Jerry <script>alert(1)</script>'

type Sent = { to: string; subject: string; html: string; text: string }

const runProbe = async (): Promise<Sent[]> => {
  // A CI-shaped env: no DATABASE_URL, so any store access is a bug in the probe
  // rather than something a developer's live database happens to satisfy.
  const env: Record<string, string> = { SERVICE_TOKEN: '', DATABASE_URL: '' }
  const proc = await runProbeProcess({ probe: PROBE, cwd: SERVER_DIR, env })
  expect(proc.exitCode, `probe failed:\n${proc.stdout}\n${proc.stderr}`).toBe(0)
  const out = lastJsonLine<{ sent: Sent[] }>(proc.stdout)
  expect(out.sent).toHaveLength(3)
  return out.sent
}

describe('the email routes send raw text and escaped html', () => {
  test('no subject carries an HTML entity', async () => {
    // The assertion that names the bug. All three subjects at once: the invite,
    // the report and the attendance sheet all interpolated caller-escaped values.
    const sent = await runProbe()
    for (const mail of sent) {
      expect(mail.subject).not.toContain('&amp;')
      expect(mail.subject).not.toContain('&lt;')
      expect(mail.subject).not.toContain('&quot;')
    }
  })

  test('the subject keeps the coach name verbatim', async () => {
    const sent = await runProbe()
    // Not "contains the escaped form" — contains the RAW form, because a coach
    // called `Tom & Jerry` must see their own name in their inbox.
    expect(sent.some((m) => m.subject.includes(HOSTILE))).toBe(true)
  })

  test('the plain-text body keeps it verbatim too', async () => {
    const sent = await runProbe()
    for (const mail of sent) {
      expect(mail.text).not.toContain('&amp;')
      expect(mail.text).not.toContain('&lt;')
    }
  })

  test('the html body escapes it, so the markup is inert', async () => {
    const sent = await runProbe()
    for (const mail of sent) {
      // On the TAG, not the payload: escaping neutralises `<script>` without
      // deleting the words, and a coach is entitled to see their own name.
      expect(mail.html).not.toContain('<script')
      expect(mail.html).toContain('&lt;script&gt;')
    }
  })

  test('the attendance sheet still renders the caller-built rows as markup', async () => {
    // The one caller-side escape that legitimately stays: `rowsHtml` is a real
    // `<tbody>` built in the route, so it must arrive as markup. If someone
    // "fixed" this by escaping every template argument, this is what would
    // break — a page of visible angle brackets.
    const sent = await runProbe()
    const attendance = sent.find((m) => m.subject.startsWith('Attendance sheet'))
    expect(attendance?.html).toContain('<tr>')
    expect(attendance?.html).toContain('<td')
    expect(attendance?.html).not.toContain('&lt;tr&gt;')
  })
})
