'use client'

import { usePathname } from 'next/navigation'

/**
 * Root skip link. On the landing page it jumps straight to the analyzer
 * (#analyze — the page's primary action); everywhere else it targets the
 * route's `<main id="main">` (layouts and standalone pages all carry one),
 * so the anchor never dangles the way a hardcoded #analyze did.
 */
export default function SkipLink() {
  const pathname = usePathname()
  const isLanding = pathname === '/'
  return (
    <a
      href={isLanding ? '#analyze' : '#main'}
      className="sr-only focus:not-sr-only focus:absolute focus:z-[10000] focus:p-4 focus:bg-primary focus:text-primary-foreground focus:outline-none"
    >
      {isLanding ? 'Skip to upload' : 'Skip to content'}
    </a>
  )
}
