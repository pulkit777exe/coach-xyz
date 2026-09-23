'use client'

import { useState, type FormEvent } from 'react'
import { Mail, Send } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'

const CONTACT_EMAIL = 'hello@coachxyz.app'

const hairline = 'border-[rgba(55,53,47,0.09)] dark:border-[rgba(255,255,255,0.08)]'
const inputClass = `h-9 rounded-[6px] bg-white text-sm text-[#37352f] placeholder:text-[#787774]/60 dark:bg-[#191919] dark:text-[#ececec] dark:placeholder:text-[#9b9b9b]/60 ${hairline}`
const labelClass = 'text-sm font-medium text-[#37352f] dark:text-[#ececec]'
const errorText = 'text-xs text-[#e03e3e]'

type FieldErrors = { name?: string; email?: string; message?: string }

export default function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: FieldErrors = {}
    if (!name.trim()) nextErrors.name = 'Please add your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      nextErrors.email = 'Please enter a valid email address.'
    if (!message.trim()) nextErrors.message = 'Please write a short message.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const query = new URLSearchParams({
      subject: subject.trim() || 'Hello from the CoachXYZ site',
      body: [name.trim(), email.trim(), message.trim()].filter(Boolean).join('\n\n'),
    })
    window.location.href = `mailto:${CONTACT_EMAIL}?${query.toString()}`
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label className={labelClass} htmlFor="name">
            Name
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={inputClass}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name && (
            <p role="alert" className={errorText}>
              {errors.name}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label className={labelClass} htmlFor="email">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@academy.com"
            className={inputClass}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email && (
            <p role="alert" className={errorText}>
              {errors.email}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <Label className={labelClass} htmlFor="subject">
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
        <Label className={labelClass} htmlFor="message">
          Message
        </Label>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what you’re building and how we can help."
          rows={5}
          aria-invalid={Boolean(errors.message)}
          className={`w-full rounded-[6px] border bg-white px-3 py-2 text-sm leading-6 text-[#37352f] transition-[border-color,box-shadow] outline-none placeholder:text-[#787774]/60 focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-[#191919] dark:text-[#ececec] dark:placeholder:text-[#9b9b9b]/60 ${hairline}`}
        />
        {errors.message && (
          <p role="alert" className={errorText}>
            {errors.message}
          </p>
        )}
      </div>
      <div>
        <Button
          type="submit"
          className="h-10 rounded-[6px] bg-[#2383e2] px-5 text-sm font-medium text-white hover:bg-[#1b6fb8]"
        >
          <Send className="size-4" />
          Send message
        </Button>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[#787774] dark:text-[#9b9b9b]">
          <Mail className="size-3.5" aria-hidden />
          Opens in your email app — or write to {CONTACT_EMAIL}
        </p>
      </div>
    </form>
  )
}
