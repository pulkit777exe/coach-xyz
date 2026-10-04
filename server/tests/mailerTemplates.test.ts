import { describe, expect, test } from 'bun:test'

import {
  attendanceEmail,
  digestEmail,
  escapeHtml,
  inviteEmail,
  reportEmail,
} from '../src/lib/mailer'

// ── The templates own their escaping; callers do not ─────────────────────────
//
// `mailer.test.ts` covered `escapeHtml` in isolation and
// `emailRouteGuards.test.ts` mocks the whole mailer module, so NOTHING tested
// what a template actually emits. That is why the escaping could live at the
// caller at all: the templates' contract was "args arrive pre-escaped", an
// invisible contract that one new caller away from injection, and no test would
// have noticed.
//
// Two failures, not one, and only the first is a security issue:
//
//   1. INJECTION. A value interpolated into `inner` unescaped is live markup.
//   2. HTML ENTITIES IN PLAIN TEXT. The callers escaped BEFORE calling, and the
//      escaped value then went into `subject` and `text` as well as `html`. A
//      coach named `Tom & Jerry` produced the subject line
//      "Tom &amp; Jerry invited you to ..." — wrong in a mail client, in a
//      notification list, and in any search over sent mail. Escaping is an HTML
//      concern; a plain-text field must never carry it.
//
// So each template escapes its own plain values for `html` and uses the raw
// value for `subject`/`text`. The assertions below are therefore two-sided on
// purpose: "no raw markup in html" AND "the raw text survives verbatim". Either
// half alone would pass against the old caller-escaping design.

/** A name that is hostile as markup and visibly wrong once escaped as text. */
const HOSTILE = 'Tom & Jerry <script>alert(1)</script>'

describe('inviteEmail escapes for html and keeps plain text raw', () => {
  const mail = inviteEmail(HOSTILE, 'Riverside Athletic', 'https://app.example/i/abc')

  test('the raw markup does not survive into the html', () => {
    // Assert on the TAG, not on the payload. My first version also asserted
    // `not.toContain('alert(1)')`, which failed against a CORRECT fix:
    // escaping neutralises the tag without deleting the text, so a coach named
    // "X alert(1)" must still see their own name. Escaping is not redaction.
    expect(mail.html).not.toContain('<script')
    // Escaped, so it is still legible to a human reading the source.
    expect(mail.html).toContain('&lt;script&gt;')
  })

  test('the subject carries the ORIGINAL text, with no HTML entities', () => {
    expect(mail.subject).toContain(HOSTILE)
    expect(mail.subject).not.toContain('&amp;')
    expect(mail.subject).not.toContain('&lt;')
  })

  test('the plain-text body carries the original text too', () => {
    expect(mail.text).toContain(HOSTILE)
    expect(mail.text).not.toContain('&amp;')
    expect(mail.text).not.toContain('&lt;')
  })

  test('the invite URL is escaped in html but readable in text', () => {
    // A URL is the one argument where escaping must not mangle a legitimate
    // value, and `&` in a query string is exactly the case: `&amp;` in an href is
    // correct HTML and `&` in the text is correct text. Both must be present.
    const withQuery = inviteEmail('A B', 'C D', 'https://app.example/i?a=1&b=2')
    expect(withQuery.html).toContain('a=1&amp;b=2')
    expect(withQuery.text).toContain('a=1&b=2')
  })
})

describe('reportEmail escapes for html and keeps plain text raw', () => {
  const mail = reportEmail(HOSTILE, HOSTILE, `<b>${HOSTILE}</b>`, 'https://app.example/r/1')

  test('the raw markup does not survive into the html', () => {
    // The tag, not the payload — see the note in the invite case above.
    expect(mail.html).not.toContain('<script')
    expect(mail.html).toContain('&lt;script&gt;')
  })

  test('subject and text carry the original values', () => {
    expect(mail.subject).toContain(HOSTILE)
    expect(mail.text).toContain(HOSTILE)
    expect(mail.subject).not.toContain('&amp;')
  })

  test('the summary is escaped as a value, not trusted as markup', () => {
    // The caller passes a summary that may itself contain markup. A template
    // that trusted it would render it; a template that escapes it shows the
    // characters, which is what a report excerpt should do.
    expect(mail.html).toContain('&lt;b&gt;')
  })

  test('an empty summary omits the block rather than rendering an empty shell', () => {
    const empty = reportEmail('A', 'B', '', 'https://app.example/r/2')
    expect(empty.html).toContain('View report')
  })
})

describe('attendanceEmail escapes values but not the caller-built rows', () => {
  const rowsHtml = '<tr><td>Cell</td></tr>'

  test('team and period are escaped for html and raw for the subject', () => {
    const mail = attendanceEmail(HOSTILE, HOSTILE, rowsHtml, 3, 5)
    expect(mail.html).not.toContain('<script')
    expect(mail.html).toContain('&lt;script&gt;')
    expect(mail.subject).toContain(HOSTILE)
    expect(mail.subject).not.toContain('&amp;')
    expect(mail.text).toContain(HOSTILE)
  })

  test('rowsHtml is inserted as markup, not escaped into visible tags', () => {
    // The one argument that IS pre-built HTML, by design: the caller builds a
    // <tbody>'s worth of rows and escapes each cell itself. Escaping this would
    // show the coach a wall of angle brackets, so it must pass through raw —
    // which is also why a blanket "escape every string arg" is the wrong fix.
    const mail = attendanceEmail('Riverside', 'last week', rowsHtml, 3, 5)
    expect(mail.html).toContain(rowsHtml)
    expect(mail.html).not.toContain('&lt;tr&gt;')
  })
})

describe('digestEmail owns chrome only and is left alone', () => {
  test('its pre-built html and plain text pass through untouched', () => {
    // Documented contract: the digest domain module assembles the content, and
    // this only wraps it. Escaping here would destroy the content it is handed.
    const mail = digestEmail(
      'Weekly digest',
      '<p>Intro <b>html</b></p>',
      '<ul><li>Group</li></ul>',
      'Plain text body & more',
    )
    expect(mail.subject).toBe('Weekly digest')
    expect(mail.html).toContain('<p>Intro <b>html</b></p>')
    expect(mail.html).toContain('<ul><li>Group</li></ul>')
    expect(mail.text).toBe('Plain text body & more')
  })
})

describe('escapeHtml stays exported for callers that build html themselves', () => {
  test('still escapes, so the rowsHtml path keeps working', () => {
    expect(escapeHtml(HOSTILE)).toContain('&lt;script&gt;')
  })
})
