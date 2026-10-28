import AuthHeader from '@/components/AuthHeader'

// App-page shell: accepting an invite is an authenticated action flow, and the
// header needs the live session to show who is signing in.
export const dynamic = 'force-dynamic'

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthHeader />
      {children}
    </>
  )
}
