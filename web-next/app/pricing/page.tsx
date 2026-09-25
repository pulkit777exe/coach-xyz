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
    return <Check aria-label="Included" className="inline-block size-4 text-check" />
  }
  if (value === '—') {
    return <span className="text-muted-foreground">—</span>
  }
  return <span className="tabular-nums">{value}</span>
}

export default function PricingPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-background text-foreground-strong antialiased">
      {/* ── Hero + plan cards ───────────────────────────────────────────── */}
      <section className="border-b border-border px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Pricing
          </p>
          <h1 className="mx-auto mt-4 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            Simple pricing that scales with your team
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[18px] leading-7 text-muted-foreground">
            Start free, upgrade when you need more analyses. No seat fees — pay for what you use.
          </p>
          <div className="mt-12 grid gap-4 text-left lg:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`relative flex flex-col rounded-[8px] border bg-background p-6 transition-colors duration-150 ${
                  p.highlight
                    ? 'border-primary/40'
                    : 'border-border hover:border-border-hover'
                }`}
              >
                <div
                  className={`-mx-6 -mt-6 mb-6 rounded-t-[7px] px-6 py-4 ${
                    p.highlight
                      ? 'border-b border-primary/20 bg-primary/[0.06] dark:bg-primary/[0.09]'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{p.name}</p>
                    {p.highlight && (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-label font-semibold text-link">
                        Most popular
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums">
                  {p.price}
                  {p.name === 'Pro' && (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      / mo
                    </span>
                  )}
                </p>
                <p className="mt-2 text-meta text-muted-foreground">{p.note}</p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-check" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  nativeButton={false}
                  render={<Link href={p.href} />}
                  className={
                    p.highlight
                      ? 'mt-7 h-10 w-full rounded-[6px] bg-primary text-sm font-medium text-primary-foreground hover:bg-primary-hover'
                      : 'mt-7 h-10 w-full rounded-[6px] border-input bg-transparent text-sm font-medium text-foreground-strong hover:bg-muted'
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
      <section className="bg-muted px-6 py-14 lg:px-8">
        <div className="mx-auto max-w-[900px]">
          <h2 className="text-center text-[28px] font-bold tracking-[-0.01em] text-balance sm:text-[34px]">
            Compare plans
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="py-3 pr-4 text-left text-label font-medium tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    Capability
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-label font-medium tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    Starter
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-label font-medium tracking-[0.06em] text-link uppercase"
                  >
                    Pro
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-label font-medium tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/9 dark:divide-white/8">
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

          <div className="mt-10 rounded-[8px] border border-border bg-background p-6 text-center">
            <p className="text-[17px] font-semibold">Need a custom plan?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We&rsquo;ll tailor Pro for your academy.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/contact" />}
              variant="outline"
              className="mt-4 h-10 rounded-[6px] border-input bg-transparent px-5 text-sm font-medium text-link hover:bg-muted"
            >
              Talk to sales
            </Button>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-background px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <h2 className="text-balance text-[28px] font-bold tracking-[-0.01em] sm:text-[34px]">
            Ready to ship faster?
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              nativeButton={false}
              render={<Link href="/signup" />}
              className="h-10 rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Start for free
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/contact" />}
              variant="outline"
              className="h-10 rounded-[6px] border-input bg-transparent px-5 text-sm font-medium text-link hover:bg-muted"
            >
              Get a demo
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
