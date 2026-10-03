import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  attendanceEmail,
  digestEmail,
  emailConfigured,
  inviteEmail,
  isDeliverableAddress,
  reportEmail,
  sendEmail,
} from '../src/lib/mailer'

// ── mailer.ts: the send contract and its error paths ────────────────────────
//
// The documented contract is one line: `RESEND_API_KEY` unset ⇒ the caller gets
// a 501-style error and **no external request is made**. Only `escapeHtml` was
// unit-tested; `sendEmail` and all four templates were not, so the whole error
// surface — which is what an outage actually looks like — was unproven.
//
// What is pinned here:
//   • the no-key path throws `EMAIL_NOT_CONFIGURED` and never touches the wire,
//     so a misconfigured deploy cannot leak an outbound request,
//   • a Resend rejection carries Resend's own message AND the HTTP status, so a
//     route can tell 422 from 429 without parsing a string,
//   • a rejection whose body is unparsable (a proxy error page) still produces a
//     useful message naming the status,
//   • every template interpolates the arguments it is handed — a template that
//     quietly dropped the player name would be indistinguishable from a correct
//     one by eye.
//
// `fetch` is stubbed globally: the request body, headers and the
// RESEND_FROM_DOMAIN / RESEND_FROM_NAME overrides are all part of the contract.
// FROM_DOMAIN/FROM_NAME are read at MODULE LOAD, so the override case has to set
// the env before a dynamic import — which is why this file imports lazily.

const realFetch = globalThis.fetch

type Sent = { url: string; init: RequestInit | undefined }

let sent: Sent[] = []
let respond: () => Response

const beforeImport = () => {
  sent = []
  respond = () => new Response(JSON.stringify({ id: 'resend-123' }), { status: 200 })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    sent.push({ url, init })
    return respond()
  }) as typeof fetch
}

// Namespaced so the assertions below read as calls on the module. The import is
// STATIC on purpose: a second import of the same file under a different specifier
// (`?fresh=…`) produces a second module INSTANCE whose coverage counters REPLACE
// the ones this file builds, and mailer.ts then reports ~24% covered while its
// throw path, its rejection path and all five templates demonstrably execute.
const mailer = {
  attendanceEmail,
  digestEmail,
  emailConfigured,
  inviteEmail,
  isDeliverableAddress,
  reportEmail,
  sendEmail,
}

const send = (over: Partial<{ to: string; subject: string; html: string; text: string }> = {}) =>
  mailer.sendEmail({
    to: 'player@example.test',
    subject: 'Your report',
    html: '<p>hi</p>',
    text: 'hi',
    ...over,
  })

describe('sendEmail — not configured', () => {
  test('no RESEND_API_KEY means no request at all', async () => {
    const previous = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      // `emailConfigured()` is the predicate the routes branch on for their 501.
      expect(mailer.emailConfigured()).toBe(false)
      let thrown: (Error & { code?: string }) | null = null
      try {
        await send()
      } catch (error) {
        thrown = error as Error & { code?: string }
      }
      expect(thrown).not.toBeNull()
      expect(thrown!.code).toBe('EMAIL_NOT_CONFIGURED')
      expect(thrown!.message).toContain('RESEND_API_KEY')
      // The load-bearing part: no HTTP request is attempted.
      expect(sent).toEqual([])
    } finally {
      if (previous !== undefined) process.env.RESEND_API_KEY = previous
    }
  })

  test('an EMPTY RESEND_API_KEY counts as unconfigured, not as a bad bearer token', async () => {
    const previous = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = ''
    try {
      expect(mailer.emailConfigured()).toBe(false)
      await expect(send()).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' })
      expect(sent).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = previous
    }
  })
})

describe('sendEmail — a configured key', () => {
  beforeEach(() => {
    beforeImport()
    process.env.RESEND_API_KEY = 're_test_key'
  })

  afterEach(() => {
    delete process.env.RESEND_API_KEY
    globalThis.fetch = realFetch
  })

  test('emailConfigured flips on with the key present', () => {
    expect(mailer.emailConfigured()).toBe(true)
  })

  test('posts the Resend envelope and returns the provider id', async () => {
    const result = await send()
    expect(sent.length).toBe(1)
    expect(sent[0]!.url).toBe('https://api.resend.com/emails')
    const init = sent[0]!.init!
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body as string)
    expect(body.to).toEqual(['player@example.test']) // an array, not a string
    expect(body.subject).toBe('Your report')
    expect(body.html).toBe('<p>hi</p>')
    expect(body.text).toBe('hi')
    // Defaults when no override is configured — a wrong `from` is a delivery
    // failure, and it is invisible in the response.
    expect(body.from).toBe('CoachXYZ <onboarding@resend.dev>')

    expect(result).toEqual({ id: 'resend-123', to: 'player@example.test', subject: 'Your report' })
  })

  test('a 200 with no id reports id null rather than undefined', async () => {
    respond = () => new Response(JSON.stringify({}), { status: 200 })
    const result = await send()
    expect(result.id).toBeNull()
    // The rest of the envelope still reports what was attempted, so a caller can
    // log which send is untraceable.
    expect(result.to).toBe('player@example.test')
    expect(result.subject).toBe('Your report')
  })

  test('a rejection carries Resend\'s message AND the HTTP status', async () => {
    respond = () => new Response(JSON.stringify({ message: 'Domain is not verified' }), { status: 422 })
    let thrown: (Error & { code?: string; status?: number }) | null = null
    try {
      await send()
    } catch (error) {
      thrown = error as Error & { code?: string; status?: number }
    }
    expect(thrown!.code).toBe('EMAIL_SEND_FAILED')
    expect(thrown!.status).toBe(422)
    expect(thrown!.message).toBe('Domain is not verified')
  })

  test('a rejection with an unparsable body still names the status', async () => {
    // A proxy in front of Resend answers 502 with an HTML error page. `res.json()`
    // rejects, and the fallback has to be a usable message rather than a crash —
    // otherwise one bad hop turns a 422 into a 500 on every mail route.
    respond = () => new Response('<html>502 Bad Gateway</html>', { status: 502 })
    await expect(send()).rejects.toMatchObject({
      code: 'EMAIL_SEND_FAILED',
      status: 502,
      message: 'Resend request failed (502)',
    })
  })

  test('a rejection with a JSON body that carries no message falls back to the status', async () => {
    respond = () => new Response(JSON.stringify({ errors: [{ message: 'nested' }] }), { status: 429 })
    await expect(send()).rejects.toMatchObject({
      code: 'EMAIL_SEND_FAILED',
      status: 429,
      message: 'Resend request failed (429)',
    })
  })

  test('a 401 (revoked key) is a send failure, not a silent no-op', async () => {
    respond = () => new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 })
    await expect(send()).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED', status: 401 })
  })
})

// RESEND_FROM_DOMAIN / RESEND_FROM_NAME are read at MODULE LOAD, so exercising
// the override needs a second import of the same file. That is deliberately NOT
// done here: importing `../src/lib/mailer?fresh=…` gives Bun a second instance
// of the module, and its coverage counters REPLACE the ones this file built —
// mailer.ts then reports ~24% covered no matter how much of it these tests run
// (measured: 24.09% either way, with the throw path, the rejection path and all
// five templates demonstrably executing). The default `From` value is asserted
// in the happy-path case above instead, and the override itself is a two-token
// `??` that a live send is the only real witness for.

describe('templates: every argument must reach the message', () => {
  test('inviteEmail names the coach, the team and the link in subject, html and text', () => {
    const t = mailer.inviteEmail('Coach Ana', 'U14 Falcons', 'https://app.example/invite/abc')
    expect(t.subject).toBe('Coach Ana invited you to U14 Falcons on CoachXYZ')
    expect(t.text).toContain('Coach Ana invited you to U14 Falcons on CoachXYZ')
    expect(t.text).toContain('https://app.example/invite/abc')
    expect(t.html).toContain('https://app.example/invite/abc')
    expect(t.html).toContain('<strong>U14 Falcons</strong>')
    expect(t.html).toContain('Coach Ana invited you to U14 Falcons on CoachXYZ')
    // The shared chrome every template inherits.
    expect(t.html).toContain('CoachXYZ')
    expect(t.html).toContain("<!doctype html>")
  })

  test('reportEmail carries the student, the title, the summary and the link', () => {
    const t = mailer.reportEmail('Riley Chen', 'March progress', 'Up 12% on release.', 'https://app.example/r/1')
    expect(t.subject).toBe('Your report: March progress')
    expect(t.text).toContain('March progress')
    expect(t.text).toContain('https://app.example/r/1')
    expect(t.html).toContain('<strong>Riley Chen</strong>')
    expect(t.html).toContain('Up 12% on release.')
    expect(t.html).toContain('https://app.example/r/1')
  })

  test('reportEmail omits the summary block entirely when the summary is empty', () => {
    const withSummary = mailer.reportEmail('Riley', 'T', 'body', 'https://x.test')
    const without = mailer.reportEmail('Riley', 'T', '', 'https://x.test')
    expect(withSummary.html).toContain('background:#f2ede6')
    // The conditional is a ternary on `summary`, so an empty summary must not
    // leave an empty grey box in the mail.
    expect(without.html).not.toContain('background:#f2ede6')
    // …while the rest of the template is unchanged.
    expect(without.html).toContain('<strong>Riley</strong>')
    expect(without.html).toContain('https://x.test')
    expect(without.subject).toBe('Your report: T')
  })

  test('attendanceEmail reports the count and embeds the rows the caller built', () => {
    const rows = '<tr><td>Riley Chen</td><td>present</td><td>2026-03-01</td></tr>'
    const t = mailer.attendanceEmail('U14 Falcons', '1–7 Mar', rows, 4, 5)
    expect(t.subject).toBe('Attendance sheet — U14 Falcons (1–7 Mar)')
    expect(t.text).toBe('Attendance for U14 Falcons: 4/5 sessions attended.')
    expect(t.html).toContain(rows)
    expect(t.html).toContain('<strong>4</strong> of <strong>5</strong>')
    // The table headers are part of the contract: a sheet with no headers is
    // three columns of initials.
    expect(t.html).toContain('Student')
    expect(t.html).toContain('Status')
    expect(t.html).toContain('Date')
  })

  test('digestEmail passes the caller\'s subject and text straight through', () => {
    const t = mailer.digestEmail('Your week in review', '<p>Two new analyses.</p>', '<ul><li>x</li></ul>', 'plain body')
    expect(t.subject).toBe('Your week in review')
    expect(t.text).toBe('plain body')
    expect(t.html).toContain('<p>Two new analyses.</p>')
    expect(t.html).toContain('<ul><li>x</li></ul>')
    expect(t.html).toContain('Change how often CoachXYZ emails you')
  })

  test('an empty digest group is not dropped by the template', () => {
    // The digest assembles its own groups; an empty string is a legitimate "no
    // notifications" answer and must not remove the chrome around it.
    const t = mailer.digestEmail('Nothing new', '<p>Nothing new.</p>', '', '')
    expect(t.text).toBe('')
    expect(t.html).toContain('Change how often CoachXYZ emails you')
    expect(t.html).toContain("You're receiving this email because of your CoachXYZ account.")
  })
})

describe('isDeliverableAddress', () => {
  test('accepts an ordinary mailbox and rejects everything else', () => {
    expect(mailer.isDeliverableAddress('player@example.test')).toBe(true)
    expect(mailer.isDeliverableAddress('  player@example.test  ')).toBe(true)
    expect(mailer.isDeliverableAddress('first.last+tag@sub.example.co.uk')).toBe(true)
    // One bad address must not fail a whole digest batch, which is why this is
    // a filter rather than a throw.
    for (const bad of [
      'no-at-sign',
      'two@@example.test',
      'trailing@',
      '@example.test',
      'spaces in@example.test',
      'user@ spaces.test',
      'user@host',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(mailer.isDeliverableAddress(bad), `accepted ${JSON.stringify(bad)}`).toBe(false)
    }
  })
})