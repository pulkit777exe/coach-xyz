// ── Outbound email via Resend ─────────────────────────────────────────────
// Uses the Resend REST API directly (no SDK dependency). Every send degrades
// gracefully: if RESEND_API_KEY is missing, the caller gets a 501-style error
// and no external request is made.

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN ?? 'onboarding@resend.dev'
const FROM_NAME = process.env.RESEND_FROM_NAME ?? 'CoachXYZ'

export const emailConfigured = (): boolean => !!process.env.RESEND_API_KEY

type SendEmailArgs = {
  to: string
  subject: string
  html: string
  text: string
}

export type MailResult = {
  id: string | null
  to: string
  subject: string
}

export async function sendEmail(args: SendEmailArgs): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw Object.assign(new Error('Email sending is not configured (RESEND_API_KEY missing).'), {
      code: 'EMAIL_NOT_CONFIGURED',
    })
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_DOMAIN}>`,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    throw Object.assign(new Error(body.message ?? `Resend request failed (${res.status})`), {
      code: 'EMAIL_SEND_FAILED',
      status: res.status,
    })
  }

  const data = (await res.json()) as { id?: string }
  return { id: data.id ?? null, to: args.to, subject: args.subject }
}

// ── Template helpers ────────────────────────────────────────────────────────

/**
 * Chrome around a template body.
 *
 * `title` is escaped HERE, at the sink, because this is the one place the
 * subject is used as markup: it becomes the visible `<h1>`. It is safe today
 * only by accident — callers pre-escaped before calling, so the value happened
 * to arrive already encoded. That is the whole fragility of escaping at the
 * caller: this `<h1>` is one refactor away from being injectable, and nothing
 * would fail. Note the asymmetry this creates deliberately — the RETURNED
 * `subject` field stays raw for plain text while the `<h1>` is escaped, so the
 * same input is encoded in one place and not the other. That is correct: the
 * question "is this text or markup?" has no answer at the call site.
 */
const wrap = (title: string, inner: string) => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f4;font-family:Inter,Arial,sans-serif;color:#433B34;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
        <span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:6px;background:#BCF56C;color:#433B34;font-weight:700;font-size:13px;">C</span>
        <span style="font-weight:700;font-size:15px;">CoachXYZ</span>
      </div>
      <div style="background:#ffffff;border:1px solid #e8e0d5;border-radius:14px;padding:28px;">
        <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(title)}</h1>
        ${inner}
      </div>
      <p style="font-size:12px;color:#7a6e62;margin-top:20px;text-align:center;">
        You're receiving this email because of your CoachXYZ account.
      </p>
    </div>
  </body>
</html>
`

/**
 * Build an email body.
 *
 * `esc` is the value already escaped for HTML; `raw` is the ORIGINAL. Passing
 * both is the whole point of this helper: `subject` and `text` are plain text
 * and must carry the value verbatim, while `inner` is markup and must not. When
 * the templates escaped nothing and relied on callers to pre-escape, the escaped
 * value leaked into the subject line, so a coach named `Tom & Jerry` produced
 * "Tom &amp; Jerry invited you to ..." — visibly wrong in a mail client, in a
 * notification list, and in any search over sent mail.
 *
 * Escaping belongs at the sink, where the distinction between "this is HTML" and
 * "this is text" is actually knowable. The caller cannot know which of a
 * template's uses is which.
 */
type Escaped = { esc: string; raw: string }

/** Pair a caller-supplied value with its HTML-escaped form. */
const value = (raw: string): Escaped => ({ esc: escapeHtml(raw), raw })

export const inviteEmail = (coachNameArg: string, teamNameArg: string, inviteUrlArg: string) => {
  const coachName = value(coachNameArg)
  const teamName = value(teamNameArg)
  // A URL needs the same treatment as any other attribute value: `&` in a query
  // string becomes `&amp;`, which is correct HTML and decodes back to `&`.
  const inviteUrl = value(inviteUrlArg)
  const subject = `${coachName.raw} invited you to ${teamName.raw} on CoachXYZ`
  const inner = `
    <p>You've been invited to join <strong>${teamName.esc}</strong> on CoachXYZ.</p>
    <p>Create your account to view your profile, video analyses, attendance and reports.</p>
    <a href="${inviteUrl.esc}"
       style="display:inline-block;margin-top:12px;background:#BCF56C;color:#433B34;font-weight:600;font-size:14px;padding:10px 18px;border-radius:999px;text-decoration:none;">
      Accept invite
    </a>
    <p style="color:#7a6e62;font-size:13px;margin-top:20px;">Or paste this link: ${inviteUrl.esc}</p>
  `
  return {
    subject,
    html: wrap(subject, inner),
    text: `${coachName.raw} invited you to ${teamName.raw} on CoachXYZ. Create your account here: ${inviteUrl.raw}`,
  }
}

export const reportEmail = (
  studentNameArg: string,
  reportTitleArg: string,
  summaryArg: string,
  reportUrlArg: string,
) => {
  const studentName = value(studentNameArg)
  const reportTitle = value(reportTitleArg)
  const summary = value(summaryArg)
  const reportUrl = value(reportUrlArg)
  const subject = `Your report: ${reportTitle.raw}`
  const inner = `
    <p><strong>${studentName.esc}</strong>, a new report is ready for you.</p>
    ${summary.raw ? `<div style="background:#f2ede6;border-radius:10px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.6;">${summary.esc}</div>` : ''}
    <a href="${reportUrl.esc}"
       style="display:inline-block;background:#BCF56C;color:#433B34;font-weight:600;font-size:14px;padding:10px 18px;border-radius:999px;text-decoration:none;">
      View report
    </a>
  `
  return {
    subject,
    html: wrap(subject, inner),
    text: `Your report "${reportTitle.raw}" is ready. ${reportUrl.raw}`,
  }
}

export const attendanceEmail = (
  teamName: string,
  periodLabel: string,
  rowsHtml: string,
  present: number,
  total: number,
) => {
  // `teamName` and `periodLabel` are plain values and are escaped for the HTML.
  // `rowsHtml` is NOT: the caller builds a `<tbody>`'s worth of rows and escapes
  // each cell itself, so escaping it here would show the coach a wall of angle
  // brackets. That asymmetry is why the fix is not a blanket "escape every
  // string argument".
  const team = value(teamName)
  const period = value(periodLabel)
  const subject = `Attendance sheet — ${team.raw} (${period.raw})`
  const inner = `
    <p>Attendance for <strong>${team.esc}</strong> — ${period.esc}.</p>
    <p><strong>${present}</strong> of <strong>${total}</strong> recorded sessions attended.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px;">
      <thead>
        <tr style="background:#f2ede6;text-align:left;">
          <th style="padding:8px 10px;border-bottom:1px solid #e8e0d5;">Student</th>
          <th style="padding:8px 10px;border-bottom:1px solid #e8e0d5;">Status</th>
          <th style="padding:8px 10px;border-bottom:1px solid #e8e0d5;">Date</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `
  return {
    subject,
    html: wrap(subject, inner),
    text: `Attendance for ${team.raw}: ${present}/${total} sessions attended.`,
  }
}

/** HTML-escape for email templates. Coerces Dates/numbers (Bun returns
 *  date columns as Date objects) so template interpolation never throws. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Shared deliverability check for an outbound address. Posters must point at a
 * real mailbox; Resend rejects the rest, and one bad address must not fail a
 * whole digest batch.
 */
export const isDeliverableAddress = (value: unknown): boolean =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/**
 * Notification digest shell. The content (subject, intro, per-day groups,
 * overflow note, plain-text body) is assembled by the digest domain module —
 * this owns the chrome only, exactly like the templates above.
 */
export const digestEmail = (
  subject: string,
  introHtml: string,
  groupsHtml: string,
  textBody: string,
) => {
  const inner = `
    ${introHtml}
    ${groupsHtml}
    <p style="font-size:12px;color:#7a6e62;margin-top:20px;">
      Change how often CoachXYZ emails you from your notification settings.
    </p>
  `
  return {
    subject,
    html: wrap(subject, inner),
    text: textBody,
  }
}
