import AuthHeader from '@/components/AuthHeader'

// App-page shell: the page resolves the signed-in org per request.
export const dynamic = 'force-dynamic'

export default function AnalyzeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthHeader />
      {children}
    </>
  )
}
