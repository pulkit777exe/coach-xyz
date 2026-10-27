import Link from 'next/link'
import { Globe } from 'lucide-react'
import NewsletterForm from '@/components/marketing/NewsletterForm'

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Workflow' },
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'For teams',
    links: [
      { href: '/signup', label: 'Get started free' },
      { href: '/contact', label: 'Request a demo' },
      { href: '/#analyze', label: 'Analyze a video' },
    ],
  },
]

const hairline = 'border-border'
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const footerLink = `block text-body leading-5 text-foreground transition-colors duration-[var(--dur-fast)] hover:text-primary hover:underline ${focusRing}`

export default function MarketingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className={`border-t px-6 py-12 lg:px-8 ${hairline} bg-muted`}>
      <div className="mx-auto max-w-[1120px]">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]">
          <div>
            <Link href="/" className={`inline-flex items-center gap-2 rounded-[6px] ${focusRing}`}>
              <span className="grid size-6 place-items-center rounded-[6px] bg-primary text-label font-bold text-primary-foreground">
                C
              </span>
              <span className="text-body leading-5 font-semibold text-foreground-strong">
                CoachXYZ
              </span>
            </Link>
            <blockquote className="mt-5 max-w-[280px] border-l-2 border-input pl-4 text-body italic leading-[1.6] text-muted-foreground">
              &ldquo;CoachXYZ cut our review time in half. Players get precise fixes same
              day.&rdquo;
            </blockquote>
            <cite className="mt-2 block pl-4 text-meta not-italic text-muted-foreground/70">
              — David R., Performance Coach
            </cite>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-meta font-medium text-muted-foreground">{col.title}</p>
              <div className="mt-3 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <Link key={l.label} href={l.href} className={footerLink}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* newsletter */}
        <div
          className={`mt-10 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between ${hairline}`}
        >
          <p className="text-meta text-muted-foreground">
            Get product updates — no spam, unsubscribe anytime.
          </p>
          <NewsletterForm />
        </div>

        {/* bottom row */}
        <div
          className={`mt-6 flex flex-col items-start justify-between gap-4 border-t pt-6 sm:flex-row sm:items-center ${hairline}`}
        >
          <div className="flex flex-wrap items-center gap-4 text-meta text-muted-foreground">
            <span>© {year} CoachXYZ, Inc.</span>
            <button
              type="button"
              className={`rounded-[6px] transition-colors duration-[var(--dur-fast)] hover:text-primary hover:underline ${focusRing}`}
            >
              Cookie settings
            </button>
          </div>
          <button
            type="button"
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-meta font-medium text-foreground transition-colors duration-150 hover:bg-accent ${hairline} ${focusRing}`}
          >
            <Globe className="size-3.5" aria-hidden />
            English
          </button>
        </div>
      </div>
    </footer>
  )
}
