import HeaderClient from '@/components/HeaderClient'

// Static marketing shell. These routes carry no per-request data — no session
// read, no cookies, no fetch — so they are prerendered at build time and served
// from the cache. `force-static` makes that a build-time guarantee rather than
// an accident: a dynamic API added under this layout fails the build instead of
// silently turning every marketing page into a per-request render.
export const dynamic = 'force-static'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // Signed out in the prerendered HTML; HeaderClient fills the session in from
  // the browser so the page itself stays cacheable and identical for everyone.
  return (
    <>
      <HeaderClient user={null} />
      {children}
    </>
  )
}
