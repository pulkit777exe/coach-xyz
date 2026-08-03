'use client'

import { useState, useRef, useEffect } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  const handleSubmit = () => {
    if (!value.trim() || disabled) return
    onSend(value.trim())
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }

  return (
    <div className="flex items-end gap-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          handleInput()
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        maxLength={2000}
        className="flex-1 resize-none rounded-none border border-(--cream-10) bg-transparent px-4 py-3 text-sm text-(--fg) placeholder:text-(--cream-40) focus:border-(--cream-20) focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="shrink-0 rounded-none border border-(--cream-10) bg-(--fg) px-5 py-3 text-sm font-semibold text-(--bg) transition-all hover:bg-(--fg)/90 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
