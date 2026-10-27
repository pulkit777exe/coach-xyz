'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/9ui/ui/button'

const hairline = 'border-border'

export default function NewsletterForm() {
  const [subscribeEmail, setSubscribeEmail] = useState('')
  const subscribe = (e: FormEvent) => {
    e.preventDefault()
    const query = new URLSearchParams({ subject: 'Newsletter signup', body: subscribeEmail.trim() })
    window.location.href = `mailto:hello@coachxyz.app?${query.toString()}`
  }

  return (
    <form onSubmit={subscribe} className="flex gap-2">
      <label htmlFor="footer-subscribe" className="sr-only">
        Email address
      </label>
      <input
        id="footer-subscribe"
        value={subscribeEmail}
        onChange={(e) => setSubscribeEmail(e.target.value)}
        type="email"
        required
        placeholder="you@academy.com"
        className={`h-9 w-[220px] rounded-[6px] border bg-background px-3 text-body leading-5 text-foreground-strong transition-colors duration-150 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${hairline}`}
      />
      <Button
        type="submit"
        size="sm"
        className="h-9 rounded-[6px] bg-primary px-4 text-body leading-5 font-medium text-primary-foreground hover:bg-primary-hover"
      >
        Subscribe
      </Button>
    </form>
  )
}
