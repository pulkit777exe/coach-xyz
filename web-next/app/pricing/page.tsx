import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export const metadata: Metadata = {
  title: 'Pricing | CoachXYZ',
  description: 'Simple pricing that scales with your academy.',
}

const plans = [
  {
    name: 'Starter',
    price: 'Free',
    note: 'For solo coaches',
    cta: 'Start for free',
    href: '/signup',
    features: ['Up to 5 athletes', '10 analyses / month', '1 sport', 'Community support'],
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$49',
    note: 'per month, billed yearly',
    cta: 'Start 14-day trial',
    href: '/signup',
    features: [
      'Unlimited athletes',
      '500 analyses / month',
      'All 6 sports',
      'Priority support',
      'Team invites & reports',
      'Video overlays',
    ],
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    note: 'For academies & federations',
    cta: 'Contact sales',
    href: '/contact',
    features: [
      'Unlimited everything',
      'SSO & SCIM',
      'SAML, audit log',
      'Dedicated success manager',
    ],
    highlight: false,
  },
]

const COMPARE_ROWS: [string, string, string, string][] = [
  ['Analyses / mo', '10', '500', 'Unlimited'],
  ['Sports', '1', '6', '6'],
  ['Team members', '1', '10', 'Unlimited'],
  ['SSO / SCIM', '—', '—', '✓'],
]

function CompareCell({ value }: { value: string }) {
  if (value === '✓') {
    return <Check aria-label="Included" className="inline-block size-4 text-[#0f7b6c]" />
  }
  if (value === '—') {
    return <span className="text-[#787774] dark:text-[#9b9b9b]">—</span>
  }
  return <span className="tabular-nums">{value}</span>
}

export default function PricingPage() {
  return (
    <main className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      {/* ── Hero + plan cards ───────────────────────────────────────────── */}
      <section className="border-b border-[rgba(55,53,47,0.09)] px-6 py-16 lg:px-8 dark:border-[rgba(255,255,255,0.08)]">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
            Pricing
          </p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Simple pricing that scales with your team
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[18px] leading-7 text-[#787774] dark:text-[#9b9b9b]">
            Start free, upgrade when you need more analyses. No seat fees — pay for what you use.
          </p>
          <div className="mt-12 grid gap-4 text-left lg:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`relative flex flex-col rounded-[8px] border bg-white p-6 transition-colors duration-150 dark:bg-[#191919] ${
                  p.highlight
                    ? 'border-[#2383e2]/40'
                    : 'border-[rgba(55,53,47,0.09)] hover:border-[rgba(55,53,47,0.18)] dark:border-[rgba(255,255,255,0.08)] dark:hover:border-[rgba(255,255,255,0.16)]'
                }`}
              >
                <div
                  className={`-mx-6 -mt-6 mb-6 rounded-t-[7px] px-6 py-4 ${
                    p.highlight
                      ? 'border-b border-[#2383e2]/20 bg-[#2383e2]/[0.06] dark:bg-[#2383e2]/[0.09]'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{p.name}</p>
                    {p.highlight && (
                      <span className="rounded-full border border-[#2383e2]/30 bg-[#2383e2]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#2383e2] dark:text-[#4da3ec]">
                        Most popular
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums">
                  {p.price}
                  {p.name === 'Pro' && (
                    <span className="ml-1 text-sm font-normal text-[#787774] dark:text-[#9b9b9b]">
                      / mo
                    </span>
                  )}
                </p>
                <p className="mt-2 text-[13px] text-[#787774] dark:text-[#9b9b9b]">{p.note}</p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#0f7b6c]" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  nativeButton={false}
                  render={<Link href={p.href} />}
                  className={
                    p.highlight
                      ? 'mt-7 h-10 w-full rounded-[6px] bg-[#2383e2] text-sm font-medium text-white hover:bg-[#1b6fb8]'
                      : 'mt-7 h-10 w-full rounded-[6px] border-[rgba(55,53,47,0.15)] bg-transparent text-sm font-medium text-[#37352f] hover:bg-[#f7f7f5] dark:border-[rgba(255,255,255,0.15)] dark:text-[#ececec] dark:hover:bg-[#202020]'
                  }
                  variant={p.highlight ? 'default' : 'outline'}
                >
                  {p.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Compare plans — horizontal hairlines only ───────────────────── */}
      <section className="bg-[#f7f7f5] px-6 py-14 lg:px-8 dark:bg-[#202020]">
        <div className="mx-auto max-w-[900px]">
          <h2 className="text-center text-[28px] font-bold tracking-[-0.01em] text-balance sm:text-[34px]">
            Compare plans
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-[rgba(55,53,47,0.09)] dark:border-[rgba(255,255,255,0.08)]">
                  <th
                    scope="col"
                    className="py-3 pr-4 text-left text-[11px] font-medium tracking-[0.06em] text-[#787774] uppercase dark:text-[#9b9b9b]"
                  >
                    Capability
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-[11px] font-medium tracking-[0.06em] text-[#787774] uppercase dark:text-[#9b9b9b]"
                  >
                    Starter
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-[11px] font-medium tracking-[0.06em] text-[#2383e2] uppercase dark:text-[#4da3ec]"
                  >
                    Pro
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-[11px] font-medium tracking-[0.06em] text-[#787774] uppercase dark:text-[#9b9b9b]"
                  >
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(55,53,47,0.09)] dark:divide-[rgba(255,255,255,0.08)]">
                {COMPARE_ROWS.map((row) => (
                  <tr key={row[0]}>
                    <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                      {row[0]}
                    </th>
                    <td className="py-3.5 text-center">
                      <CompareCell value={row[1]} />
                    </td>
                    <td className="py-3.5 text-center font-semibold">
                      <CompareCell value={row[2]} />
                    </td>
                    <td className="py-3.5 text-center">
                      <CompareCell value={row[3]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 rounded-[8px] border border-[rgba(55,53,47,0.09)] bg-white p-6 text-center dark:border-[rgba(255,255,255,0.08)] dark:bg-[#191919]">
            <p className="text-[17px] font-semibold">Need a custom plan?</p>
            <p className="mt-1 text-sm text-[#787774] dark:text-[#9b9b9b]">
              We&rsquo;ll tailor Pro for your academy.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/contact" />}
              variant="outline"
              className="mt-4 h-10 rounded-[6px] border-[rgba(55,53,47,0.15)] bg-transparent px-5 text-sm font-medium text-[#2383e2] hover:bg-[#f7f7f5] dark:border-[rgba(255,255,255,0.15)] dark:text-[#4da3ec] dark:hover:bg-[#202020]"
            >
              Talk to sales
            </Button>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-white px-6 py-16 lg:px-8 dark:bg-[#191919]">
        <div className="mx-auto max-w-[1120px] text-center">
          <h2 className="text-balance text-[28px] font-bold tracking-[-0.01em] sm:text-[34px]">
            Ready to ship faster?
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              nativeButton={false}
              render={<Link href="/signup" />}
              className="h-10 rounded-[6px] bg-[#2383e2] px-5 text-sm font-medium text-white hover:bg-[#1b6fb8]"
            >
              Start for free
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/contact" />}
              variant="outline"
              className="h-10 rounded-[6px] border-[rgba(55,53,47,0.15)] bg-transparent px-5 text-sm font-medium text-[#2383e2] hover:bg-[#f7f7f5] dark:border-[rgba(255,255,255,0.15)] dark:text-[#4da3ec] dark:hover:bg-[#202020]"
            >
              Get a demo
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
