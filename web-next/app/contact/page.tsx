import type { Metadata } from 'next'
import { Mail, MessageCircle, Briefcase } from 'lucide-react'
import ContactForm from '@/components/marketing/ContactForm'

export const metadata: Metadata = {
  title: 'Contact | CoachXYZ',
  description: 'Talk to the CoachXYZ team — sales, support and partnerships.',
}

const channels = [
  {
    icon: Mail,
    title: 'Support',
    desc: 'Questions about your account, analyses or billing.',
    value: 'help@coachxyz.app',
  },
  {
    icon: MessageCircle,
    title: 'Sales',
    desc: 'Plans, trials and rolling your academy out to hundreds of athletes.',
    value: 'sales@coachxyz.app',
  },
  {
    icon: Briefcase,
    title: 'Partnerships',
    desc: 'Associations, federations and licensing.',
    value: 'partners@coachxyz.app',
  },
]

const hairline = 'border-[rgba(55,53,47,0.09)] dark:border-[rgba(255,255,255,0.08)]'

export default function ContactPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-[rgba(55,53,47,0.09)] px-6 py-16 lg:px-8 dark:border-[rgba(255,255,255,0.08)]">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
            Contact
          </p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Talk to the team
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[18px] leading-7 text-[#787774] dark:text-[#9b9b9b]">
            A real human answers. Usually within one business day.
          </p>
        </div>
      </section>

      {/* ── Channels + form ─────────────────────────────────────────────── */}
      <section className="bg-[#f7f7f5] px-6 py-14 lg:px-8 dark:bg-[#202020]">
        <div className="mx-auto grid max-w-[1120px] gap-6 lg:grid-cols-2">
          <div className="grid gap-4">
            {channels.map((c) => (
              <div
                key={c.title}
                className={`flex gap-4 rounded-[6px] border bg-white p-5 transition-colors duration-[180ms] hover:bg-[#fafafa] dark:bg-[#191919] dark:hover:bg-[#1e1e1e] ${hairline}`}
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-[#2383e2]/10 text-[#2383e2] dark:text-[#4da3ec]">
                  <c.icon className="size-[18px]" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[#787774] dark:text-[#9b9b9b]">
                    {c.desc}
                  </p>
                  <a
                    href={`mailto:${c.value}`}
                    className="mt-1.5 inline-block rounded-[6px] text-sm font-medium text-[#2383e2] transition-colors duration-[120ms] hover:text-[#1b6fb8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {c.value}
                  </a>
                </div>
              </div>
            ))}
            <div className="rounded-[6px] border border-[#2383e2]/25 bg-[#2383e2]/[0.06] p-5 dark:bg-[#2383e2]/[0.09]">
              <p className="text-sm font-semibold leading-snug">
                Prefer email over forms?
                <br />
                Write to us directly — we read everything.
              </p>
              <a
                href="mailto:hello@coachxyz.app"
                className="mt-2 inline-block rounded-[6px] text-sm font-medium text-[#2383e2] transition-colors duration-[120ms] hover:text-[#1b6fb8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                hello@coachxyz.app
              </a>
            </div>
          </div>
          <div
            className={`rounded-[8px] border bg-white p-6 sm:p-8 dark:bg-[#191919] ${hairline}`}
          >
            <p className="text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
              Send a note
            </p>
            <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em]">How can we help?</h2>
            <div className="mt-5">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
