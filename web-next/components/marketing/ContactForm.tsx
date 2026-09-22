'use client'

import { useState, type FormEvent } from 'react'
import { Mail, Send } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'

const CONTACT_EMAIL = 'hello@coachxyz.app'

export default function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const query = new URLSearchParams({
      subject: subject.trim() || 'Hello from the CoachXYZ site',
      body: [name.trim(), email.trim(), message.trim()].filter(Boolean).join('\n\n'),
    })
    window.location.href = `mailto:${CONTACT_EMAIL}?${query.toString()}`
  }

  const inputClass = 'w-full border-[var(--marketing-beige)] bg-[var(--marketing-white)]'

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label
            className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-brown)]/60"
            htmlFor="name"
          >
            Name
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={inputClass}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label
            className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-brown)]/60"
            htmlFor="email"
          >
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@academy.com"
            className={inputClass}
            required
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label
          className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-brown)]/60"
          htmlFor="subject"
        >
          Subject
        </Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Sales, support, partnership…"
          className={inputClass}
        />
      </div>
      <div className="grid gap-2">
        <Label
          className="text-xs font-semibold uppercase tracking-widest text-[var(--marketing-brown)]/60"
          htmlFor="message"
        >
          Message
        </Label>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what you’re building and how we can help."
          rows={5}
          required
          className="w-full rounded-lg border border-[var(--marketing-beige)] bg-[var(--marketing-white)] px-3 py-2 text-sm text-[var(--marketing-brown)] placeholder:text-[var(--marketing-brown)]/40 outline-none focus:border-[var(--marketing-brown)]/40 focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div>
        <Button
          type="submit"
          className="rounded-full bg-primary px-6 font-semibold text-[var(--marketing-brown)] hover:bg-primary/90"
        >
          <Send className="size-4" />
          Send message
        </Button>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--marketing-brown)]/50">
          <Mail className="size-3.5" />
          Opens in your email app — or write to {CONTACT_EMAIL}
        </p>
      </div>
    </form>
  )
}
