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

const hairline = 'border-border'

export default function ContactPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-background text-foreground-strong antialiased">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-border px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Contact
          </p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Talk to the team
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[18px] leading-7 text-muted-foreground">
            A real human answers. Usually within one business day.
          </p>
        </div>
      </section>

      {/* ── Channels + form ─────────────────────────────────────────────── */}
      <section className="bg-muted px-6 py-14 lg:px-8">
        <div className="mx-auto grid max-w-[1120px] gap-6 lg:grid-cols-2">
          <div className="grid gap-4">
            {channels.map((c) => (
              <div
                key={c.title}
                className={`flex gap-4 rounded-[6px] border bg-background p-5 transition-colors duration-[var(--dur-base)] hover:bg-surface-hover ${hairline}`}
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-[6px] bg-primary/10 text-link">
                  <c.icon className="size-[18px]" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-body leading-5 font-semibold">{c.title}</p>
                  <p className="mt-1 text-body leading-6 text-muted-foreground">{c.desc}</p>
                  <a
                    href={`mailto:${c.value}`}
                    className="mt-1.5 inline-block rounded-[6px] text-body leading-5 font-medium text-primary transition-colors duration-[var(--dur-fast)] hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {c.value}
                  </a>
                </div>
              </div>
            ))}
            <div className="rounded-[6px] border border-primary/25 bg-primary/[0.06] p-5 dark:bg-primary/[0.09]">
              <p className="text-body font-semibold leading-snug">
                Prefer email over forms?
                <br />
                Write to us directly — we read everything.
              </p>
              <a
                href="mailto:hello@coachxyz.app"
                className="mt-2 inline-block rounded-[6px] text-body leading-5 font-medium text-primary transition-colors duration-[var(--dur-fast)] hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                hello@coachxyz.app
              </a>
            </div>
          </div>
          <div className={`rounded-[8px] border bg-background p-6 sm:p-8 ${hairline}`}>
            <p className="text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase">
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
