import type { Metadata } from 'next'
import { Mail, MessageCircle, Briefcase } from 'lucide-react'
import ContactForm from '@/components/marketing/ContactForm'

export const metadata: Metadata = { title: 'Contact | CoachXYZ', description: 'Talk to the CoachXYZ team — sales, support and partnerships.' }

const channels = [
  { icon: Mail, title: 'Support', desc: 'Questions about your account, analyses or billing.', value: 'help@coachxyz.app' },
  { icon: MessageCircle, title: 'Sales', desc: 'Plans, trials and rolling your academy out to hundreds of athletes.', value: 'sales@coachxyz.app' },
  { icon: Briefcase, title: 'Partnerships', desc: 'Associations, federations and licensing.', value: 'partners@coachxyz.app' },
]

export default function ContactPage() {
  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)]">
      <section className="border-b border-white/5 px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Contact</p>
          <h1 className="mx-auto mt-2 max-w-[720px] text-[32px] font-bold leading-tight tracking-tight sm:text-[36px]">Talk to the team</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-[var(--marketing-beige)]/60">
            A real human answers. Usually within one business day.
          </p>
        </div>
      </section>

      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8 text-[var(--marketing-brown)]">
        <div className="mx-auto grid max-w-[1120px] gap-6 lg:grid-cols-2">
          <div className="grid gap-4">
            {channels.map((c) => (
              <div key={c.title} className="flex gap-4 rounded-2xl border border-[var(--marketing-beige)] bg-white p-5">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-[var(--marketing-brown)]"><c.icon className="size-5" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--marketing-brown)]/60">{c.desc}</p>
                  <p className="mt-1.5 text-sm font-medium text-success">{c.value}</p>
                </div>
              </div>
            ))}
            <div className="rounded-2xl bg-primary p-5">
              <p className="text-sm font-bold leading-snug text-[var(--marketing-brown)]">Prefer email over forms?<br/>Write to us directly — we read everything.</p>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--marketing-beige)] bg-white p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Send a note</p>
            <h2 className="mt-2 text-lg font-bold">How can we help?</h2>
            <div className="mt-4">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}