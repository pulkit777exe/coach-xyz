import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Terms of Service | CoachXYZ', description: 'The terms that govern your use of CoachXYZ.' }

const sections = [
  {
    title: 'Your account',
    body: [
      'You are responsible for the security of your sign-in credentials and for activity under your account. You must provide accurate information and keep it up to date.',
      'You may use CoachXYZ only for lawful purposes and in accordance with these terms. One account may not be shared beyond your organization without a paid plan that allows it.',
    ],
  },
  {
    title: 'Your content',
    body: [
      'You retain ownership of the videos, images and other content you upload. We process that content to provide the analysis you request and delete it when you delete it or your account.',
      'You confirm you have the right to upload the content you submit — including the consent of any players or third parties captured in it.',
      'Analyses, scores and reports generated for you are provided for informational and coaching purposes only. Always apply professional judgment before acting on any insight.',
    ],
  },
  {
    title: 'Acceptable use',
    body: [
      'You agree not to: upload content you do not have rights to; attempt to access another account or organization’s data; probe, scrape or interfere with the service; or use the service to train competing models.',
      'We may suspend access that violates these terms, with notice where practical, while we investigate.',
    ],
  },
  {
    title: 'Subscriptions and billing',
    body: [
      'Paid plans are billed in advance. Cancelling stops future billing at the end of the current period; usage and stored data up to that point remain available until your plan expires.',
      'Plans include stated usage limits. Exceeding them may require an upgrade — we will warn you before restricting anything.',
    ],
  },
  {
    title: 'Uptime and service levels',
    body: [
      'We aim for high availability but do not guarantee uninterrupted service. Where a paid plan includes a service-level credit, refunds follow the published schedule.',
    ],
  },
  {
    title: 'Disclaimer of warranties',
    body: [
      'CoachXYZ is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, whether express or implied, including fitness for a particular purpose and non-infringement. Analyses may occasionally be wrong — they are a starting point for your own judgment, never a substitute for it.',
    ],
  },
  {
    title: 'Limitation of liability',
    body: [
      'To the maximum extent permitted by law, CoachXYZ and its operators are not liable for indirect, incidental, special or consequential damages, or for lost profits, data or goodwill, arising from your use of the service. Our total liability for any claim is limited to the amounts you paid us in the twelve months before the claim.',
    ],
  },
  {
    title: 'Termination',
    body: [
      'You may delete your account at any time; your content is removed as described in our Privacy Policy. We may terminate accounts that violate these terms, and you may appeal by writing to help@coachxyz.app.',
    ],
  },
  {
    title: 'Changes and governing law',
    body: [
      'We may update these terms; material changes will be announced ahead of taking effect. Continued use after a change constitutes acceptance. These terms are governed by the laws applicable in the jurisdiction where CoachXYZ operates, excluding its conflict-of-law rules.',
    ],
  },
]

export default function TermsPage() {
  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)]">
      <section className="border-b border-[var(--marketing-white)]/5 px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[720px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Legal</p>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight">Terms of Service</h1>
          <p className="mt-2 text-sm text-[var(--marketing-beige)]/50">Last updated: September 15, 2026</p>
        </div>
      </section>
      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8 text-[var(--marketing-brown)]">
        <div className="mx-auto max-w-[720px]">
          <p className="text-sm leading-6 text-[var(--marketing-brown)]/70">
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of CoachXYZ. By creating an account or using
            the service you agree to be bound by them. Please read them carefully.
          </p>
          <div className="mt-10 space-y-8">
            {sections.map((s) => (
              <section key={s.title}>
                <h2 className="text-base font-bold">{s.title}</h2>
                <div className="mt-2 space-y-3">
                  {s.body.map((p) => (
                    <p key={p.slice(0, 32)} className="text-sm leading-6 text-[var(--marketing-brown)]/70">{p}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="mt-12 rounded-2xl border border-[var(--marketing-beige)] bg-[var(--marketing-white)] p-6">
            <h2 className="text-base font-bold">Contact</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--marketing-brown)]/70">
              Questions about these terms? Email <span className="font-medium text-[var(--marketing-brown)]">help@coachxyz.app</span>.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}