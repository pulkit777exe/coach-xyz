import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | CoachXYZ',
  description: 'How CoachXYZ collects, uses and protects your data.',
}

const sections = [
  {
    title: 'Information we collect',
    body: [
      'Account information: your name, email address and profile picture when you sign in with Auth0. Player profiles: for athletes, we store the details your coach adds (name, sport, position) as well as any account you link when signing in.',
      'Content you upload: match and drill videos you submit for analysis, along with the resulting annotations, scores and reports.',
      'Usage data: basic telemetry such as pages visited, analyses run and feature usage, used to keep the service fast and reliable.',
    ],
  },
  {
    title: 'How we use it',
    body: [
      'To provide CoachXYZ: process uploads, generate analyses, track attendance, maintain rosters and deliver reports to you and the players you add.',
      'To operate and improve: fix bugs, measure performance and build features we have evidence coaches actually use.',
      'To communicate: send transactional emails such as invites, report notifications and service updates. We do not sell your data, and we do not use your content to train models for other customers.',
    ],
  },
  {
    title: 'Who we share it with',
    body: [
      'Service providers who help run CoachXYZ — including Auth0 for sign-in, Resend for transactional email, and our infrastructure hosts — under data-processing terms that only allow them to act on our instructions.',
      'Players you explicitly connect: when you invite an athlete to your roster, that athlete can see the analyses, scores and attendance records their coach shares with them.',
      'Authorities or legal process only where required by law and pursued through a validated request.',
    ],
  },
  {
    title: 'Retention',
    body: [
      'We keep your videos and analyses for as long as your account is active. When you delete a video, a report or your account, the associated content is removed from active storage and purged from backups within 30 days.',
      'Attendance, roster and report history is retained as part of your coaching record and is deletable in full by removing your account.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Traffic is encrypted in transit (TLS). Videos and reports are stored separately from your identity, and scoped URLs are time-limited. Access to your organization’s data is restricted by your verified identity using your Auth0 account.',
    ],
  },
  {
    title: 'Your rights',
    body: [
      'You can access, correct or delete the personal information we hold by contacting help@coachxyz.app or by using the controls in your dashboard. Where local law applies, you may also request a copy of your data in a portable format and object to or restrict certain processing.',
    ],
  },
  {
    title: 'Cookies',
    body: [
      'We use strictly necessary cookies for sign-in sessions and minimal analytics. We do not run third-party advertising trackers on the site.',
    ],
  },
  {
    title: 'Changes to this policy',
    body: [
      'We will post any changes here and update the "Last updated" date. Material changes will also be announced through the product and to the primary email on file.',
    ],
  },
]

const hairline = 'border-[rgba(55,53,47,0.09)] dark:border-[rgba(255,255,255,0.08)]'

export default function PrivacyPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      <section className={`border-b px-6 py-14 lg:px-8 ${hairline}`}>
        <div className="mx-auto max-w-[720px]">
          <p className="text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
            Legal
          </p>
          <h1 className="mt-3 text-balance text-[32px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[40px]">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-[#787774] tabular-nums dark:text-[#9b9b9b]">
            Last updated: September 15, 2026
          </p>
        </div>
      </section>
      <section className="px-6 py-12 lg:px-8">
        <div className="mx-auto max-w-[720px]">
          <p className="text-[16px] leading-[1.6] text-[#37352f]/80 dark:text-[#ececec]/80">
            CoachXYZ (&ldquo;we,&rdquo; &ldquo;us&rdquo;) provides AI-powered sports video analysis
            for coaches and their teams. This policy explains what we collect, why, and the choices
            you have. By using CoachXYZ you agree to the practices below.
          </p>
          <div className={`mt-10 border-t ${hairline}`}>
            {sections.map((s, i) => (
              <section
                key={s.title}
                className={`grid gap-4 py-8 sm:grid-cols-[56px_1fr] ${hairline} border-b`}
              >
                <span className="text-[13px] font-medium text-[#787774]/60 tabular-nums dark:text-[#9b9b9b]/60">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h2 className="text-[16px] font-semibold">{s.title}</h2>
                  <div className="mt-2.5 space-y-3">
                    {s.body.map((p) => (
                      <p
                        key={p.slice(0, 32)}
                        className="text-[15px] leading-[1.6] text-[#37352f]/80 dark:text-[#ececec]/80"
                      >
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
          <div
            className={`mt-10 rounded-[8px] border bg-[#f7f7f5] p-6 dark:bg-[#202020] ${hairline}`}
          >
            <h2 className="text-[16px] font-semibold">Questions?</h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-[#37352f]/80 dark:text-[#ececec]/80">
              Email our Data Protection contact at{' '}
              <span className="font-medium text-[#37352f] dark:text-[#ececec]">
                help@coachxyz.app
              </span>{' '}
              — we typically answer within one business day.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
