import AuthHeader from '@/components/AuthHeader'

// App-page shell: the page reads the session per request, so the header is
// server-rendered with the real user instead of the static marketing shell.
export const dynamic = 'force-dynamic'

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthHeader />
      {children}
    </>
  )
}
