import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'

export const metadata = { title: 'Sign up | CoachXYZ' }

export default function SignupPage(){
  return (
    <main className="grid min-h-[calc(100vh-56px)] place-items-center bg-[var(--marketing-dark)] px-6 py-10">
      <div className="w-full max-w-[480px] rounded-2xl border border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)] p-6">
        <span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-bold text-[var(--marketing-brown)]">New</span>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--marketing-beige)]">Create your coaching workspace</h1>
        <p className="mt-1 text-sm text-[var(--marketing-beige)]/60">Free for up to 5 athletes. No credit card required.</p>
        <div className="mt-6 space-y-3">
          <Button render={<a href="/auth/login?screen_hint=signup" />} className="h-10 w-full rounded-full bg-primary text-[var(--marketing-brown)] hover:bg-primary/90">Sign up with Auth0</Button>
          <p className="text-center text-xs text-[var(--marketing-beige)]/40">Already have an account? <Link href="/login" className="text-[var(--marketing-lime)] underline">Log in</Link></p>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs text-[var(--marketing-beige)]/50">
          <span>✓ 6 sports</span><span>✓ 60s analysis</span><span>✓ Reports</span>
        </div>
      </div>
    </main>
  )
}
