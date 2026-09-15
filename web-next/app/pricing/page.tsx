import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export const metadata: Metadata = { title: 'Pricing | CoachXYZ', description: 'Simple pricing that scales with your academy.' }

const plans = [
  { name:'Starter', price:'Free', note:'For solo coaches', cta:'Start for free', href:'/signup', features:['Up to 5 athletes','10 analyses / month','1 sport','Community support'], highlight:false },
  { name:'Pro', price:'$49', note:'per month, billed yearly', cta:'Start 14-day trial', href:'/signup', features:['Unlimited athletes','500 analyses / month','All 6 sports','Priority support','Team invites & reports','Video overlays'], highlight:true },
  { name:'Enterprise', price:'Custom', note:'For academies & federations', cta:'Contact sales', href:'/contact', features:['Unlimited everything','SSO & SCIM','SAML, audit log','Dedicated success manager'], highlight:false },
]

export default function PricingPage(){
  return (
    <main className="bg-[var(--marketing-dark)] text-[var(--marketing-beige)]">
      <section className="border-b border-white/5 px-6 py-10 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Pricing</p>
          <h1 className="mx-auto mt-2 max-w-[720px] text-[32px] font-bold leading-tight tracking-tight sm:text-[36px]">Simple pricing that scales<br/>with your team</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-[var(--marketing-beige)]/60">Start free, upgrade when you need more analyses. No seat fees — pay for what you use.</p>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {plans.map(p=>(
              <div key={p.name} className={`relative flex flex-col rounded-2xl border p-6 text-left ${p.highlight ? 'border-primary bg-primary text-[var(--marketing-brown)]' : 'border-white/10 bg-[var(--marketing-dark-card)] text-[var(--marketing-beige)]'}`}>
                {p.highlight && <span className="absolute -top-3 left-6 rounded-full bg-[var(--marketing-brown)] px-3 py-1 text-xs font-bold text-primary">Most popular</span>}
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight">{p.price}<span className="text-sm font-normal opacity-60"> {p.name!=='Free' && p.name!=='Custom' ? '/ mo' : ''}</span></p>
                <p className="text-xs opacity-60">{p.note}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {p.features.map(f=> <li key={f} className="flex gap-2"><Check className={`mt-0.5 size-4 ${p.highlight?'text-[var(--marketing-brown)]':'text-success'}`}/> {f}</li>)}
                </ul>
                <Button render={<Link href={p.href} />} className={`mt-6 h-10 rounded-full font-semibold ${p.highlight ? 'bg-[var(--marketing-brown)] text-primary hover:bg-black' : 'bg-primary text-[var(--marketing-brown)] hover:bg-primary/90'}`}>
                  {p.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--marketing-light)] px-6 py-10 lg:px-8 text-[var(--marketing-brown)]">
        <div className="mx-auto max-w-[900px]">
          <h2 className="text-center text-lg font-bold">Compare plans</h2>
          <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--marketing-beige)] bg-white">
            <div className="grid grid-cols-4 gap-px bg-[var(--marketing-beige)]">
              <div className="bg-white p-4 text-sm font-semibold">Capability</div>
              <div className="bg-white p-4 text-center text-sm font-semibold">Starter</div>
              <div className="bg-primary p-4 text-center text-sm font-bold">Pro</div>
              <div className="bg-white p-4 text-center text-sm font-semibold">Enterprise</div>
              {[
                ['Analyses / mo','10','500','Unlimited'],
                ['Sports','1','6','6'],
                ['Team members','1','10','Unlimited'],
                ['SSO / SCIM','—','—','✓'],
              ].map(row=>(
                <div key={row[0]} className="contents">
                  <div className="bg-white p-3 text-sm">{row[0]}</div>
                  <div className="bg-white p-3 text-center text-sm">{row[1]}</div>
                  <div className="bg-primary/15 p-3 text-center text-sm font-semibold">{row[2]}</div>
                  <div className="bg-white p-3 text-center text-sm">{row[3]}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 rounded-2xl bg-primary p-6 text-center">
            <p className="font-bold text-[var(--marketing-brown)]">Need a custom plan?</p>
            <p className="text-sm text-[var(--marketing-brown)]/70">We’ll tailor Pro for your academy.</p>
            <Button render={<Link href="/contact" />} className="mt-3 rounded-full bg-[var(--marketing-brown)] text-[var(--marketing-beige)] hover:bg-black">Talk to sales</Button>
          </div>
        </div>
      </section>

      <section className="bg-[var(--marketing-dark)] px-6 py-12 lg:px-8">
        <div className="mx-auto max-w-[1120px] text-center">
          <h2 className="text-xl font-bold">Ready to ship faster?</h2>
          <div className="mt-4 flex justify-center gap-3">
            <Button render={<Link href="/signup" />} className="rounded-full bg-primary text-[var(--marketing-brown)] hover:bg-primary/90">Start for free</Button>
            <Button render={<Link href="/contact" />} variant="outline" className="rounded-full border-white/15 text-[var(--marketing-beige)] hover:bg-white/5">Get a demo</Button>
          </div>
        </div>
      </section>
    </main>
  )
}
