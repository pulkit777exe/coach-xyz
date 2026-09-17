import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'

export const metadata = { title: 'Log in | CoachXYZ' }

export default function LoginPage(){
  return (
    <main className="grid min-h-[calc(100vh-56px)] place-items-center bg-[var(--marketing-dark)] px-6 py-10">
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[var(--marketing-dark-card)] p-6">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-xs font-bold text-[var(--marketing-brown)]">C</span>
          <span className="text-sm font-bold text-[var(--marketing-beige)]">CoachXYZ</span>
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-[var(--marketing-beige)]">Welcome back</h1>
        <p className="mt-1 text-sm text-[var(--marketing-beige)]/60">Log in with your team account. We use secure Auth0.</p>
        <div className="mt-6 space-y-3">
          <Button render={<a href="/auth/login" />} className="h-10 w-full rounded-full bg-primary text-[var(--marketing-brown)] hover:bg-primary/90">Continue with Auth0</Button>
          <Button render={<a href="/signup" />} variant="outline" className="h-10 w-full rounded-full border-white/15 text-[var(--marketing-beige)] hover:bg-white/5">Create an account →</Button>
        </div>
        <p className="mt-4 text-center text-xs text-[var(--marketing-beige)]/50">By continuing you agree to our <Link href="/terms" className="underline decoration-white/20">Terms</Link> and <Link href="/privacy" className="underline decoration-white/20">Privacy</Link>.</p>
      </div>
    </main>
  )
}
