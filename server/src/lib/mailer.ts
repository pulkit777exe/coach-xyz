// ── Outbound email via Resend ─────────────────────────────────────────────
// Uses the Resend REST API directly (no SDK dependency). Every send degrades
// gracefully: if RESEND_API_KEY is missing, the caller gets a 501-style error
// and no external request is made.

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN ?? "onboarding@resend.dev";
const FROM_NAME = process.env.RESEND_FROM_NAME ?? "CoachXYZ";

export const emailConfigured = (): boolean => !!process.env.RESEND_API_KEY;

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type MailResult = {
  id: string | null;
  to: string;
  subject: string;
};

export async function sendEmail(args: SendEmailArgs): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error("Email sending is not configured (RESEND_API_KEY missing)."),
      {
        code: "EMAIL_NOT_CONFIGURED",
      },
    );
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_DOMAIN}>`,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw Object.assign(
      new Error(body.message ?? `Resend request failed (${res.status})`),
      { code: "EMAIL_SEND_FAILED", status: res.status },
    );
  }

  const data = (await res.json()) as { id?: string };
  return { id: data.id ?? null, to: args.to, subject: args.subject };
}

// ── Template helpers ────────────────────────────────────────────────────────

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
        <h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
        ${inner}
      </div>
      <p style="font-size:12px;color:#7a6e62;margin-top:20px;text-align:center;">
        You're receiving this email because of your CoachXYZ account.
      </p>
    </div>
  </body>
</html>
`;

export const inviteEmail = (
  coachName: string,
  teamName: string,
  inviteUrl: string,
) => {
  const subject = `${coachName} invited you to ${teamName} on CoachXYZ`;
  const inner = `
    <p>You've been invited to join <strong>${teamName}</strong> on CoachXYZ.</p>
    <p>Create your account to view your profile, video analyses, attendance and reports.</p>
    <a href="${inviteUrl}"
       style="display:inline-block;margin-top:12px;background:#BCF56C;color:#433B34;font-weight:600;font-size:14px;padding:10px 18px;border-radius:999px;text-decoration:none;">
      Accept invite
    </a>
    <p style="color:#7a6e62;font-size:13px;margin-top:20px;">Or paste this link: ${inviteUrl}</p>
  `;
  return {
    subject,
    html: wrap(subject, inner),
    text: `${coachName} invited you to ${teamName} on CoachXYZ. Create your account here: ${inviteUrl}`,
  };
};

export const reportEmail = (
  studentName: string,
  reportTitle: string,
  summary: string,
  reportUrl: string,
) => {
  const subject = `Your report: ${reportTitle}`;
  const inner = `
    <p><strong>${studentName}</strong>, a new report is ready for you.</p>
    ${summary ? `<div style="background:#f2ede6;border-radius:10px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.6;">${summary}</div>` : ""}
    <a href="${reportUrl}"
       style="display:inline-block;background:#BCF56C;color:#433B34;font-weight:600;font-size:14px;padding:10px 18px;border-radius:999px;text-decoration:none;">
      View report
    </a>
  `;
  return {
    subject,
    html: wrap(subject, inner),
    text: `Your report "${reportTitle}" is ready. ${reportUrl}`,
  };
};

export const attendanceEmail = (
  teamName: string,
  periodLabel: string,
  rowsHtml: string,
  present: number,
  total: number,
) => {
  const subject = `Attendance sheet — ${teamName} (${periodLabel})`;
  const inner = `
    <p>Attendance for <strong>${teamName}</strong> — ${periodLabel}.</p>
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
  `;
  return {
    subject,
    html: wrap(subject, inner),
    text: `Attendance for ${teamName}: ${present}/${total} sessions attended.`,
  };
};

export const escapeHtml = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
