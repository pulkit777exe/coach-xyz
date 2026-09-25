'use client'

import { useEffect, useState } from 'react'

/**
 * Hero highlight that types one phrase at a time: characters type in,
 * the full phrase holds, then it fades out (ease-in) and the next phrase
 * fades back in (ease-out) — Notion-style blue pill throughout.
 *
 * Reduced motion (app `.reduce-motion` class or OS preference) freezes it
 * on the first phrase with no timers scheduled.
 */

const PHRASES = [
  "athlete's journey",
  'jump shot',
  'free kick',
  'cover drive',
  'backhand',
  'slap shot',
]

/** Per-character cadence. */
const TYPE_MS = 60
/** Full phrase visible before the exit fade. */
const HOLD_MS = 1700
/** Exit/entrance fade — motion skill: <300ms. */
const FADE_MS = 220

type Phase = 'typing' | 'holding' | 'fading'

export default function TypewriterHighlight() {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('typing')
  const [reduced, setReduced] = useState(false)

  // Read reduced-motion once, rAF-deferred (no sync setState in effect body).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setReduced(
        document.documentElement.classList.contains('reduce-motion') ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // Typewriter state machine — every transition is a cleanup-tracked timeout,
  // updates are functional. Skipped entirely under reduced motion.
  useEffect(() => {
    if (reduced) return
    const phrase = PHRASES[phraseIndex]

    if (phase === 'typing') {
      if (text.length < phrase.length) {
        const t = setTimeout(() => setText(phrase.slice(0, text.length + 1)), TYPE_MS)
        return () => clearTimeout(t)
      }
      const t = setTimeout(() => setPhase('holding'), 0)
      return () => clearTimeout(t)
    }

    if (phase === 'holding') {
      const t = setTimeout(() => setPhase('fading'), HOLD_MS)
      return () => clearTimeout(t)
    }

    // fading — wait for the exit transition, then swap to the next phrase.
    const t = setTimeout(() => {
      setPhraseIndex((i) => (i + 1) % PHRASES.length)
      setText('')
      setPhase('typing')
    }, FADE_MS)
    return () => clearTimeout(t)
  }, [reduced, phase, text, phraseIndex])

  const display = reduced ? PHRASES[0] : text
  const isFading = phase === 'fading'
  const showCaret = !reduced && phase === 'typing' && text.length < PHRASES[phraseIndex].length

  return (
    <span className="inline-block min-w-[9em] text-center">
      {/* Visible animation — hidden from AT; sr-only carries the stable phrase. */}
      <span
        aria-hidden="true"
        className={`inline-block rounded-full bg-primary/10 px-3 text-link transition-opacity duration-[220ms] sm:px-4 dark:bg-primary/15 ${
          isFading ? 'opacity-0 [transition-timing-function:ease-in]' : 'opacity-100 [transition-timing-function:ease-out]'
        }`}
      >
        {display}
        {showCaret ? (
          <span className="ml-[3px] inline-block h-[0.8em] w-[2px] translate-y-[0.06em] bg-current align-baseline animate-pulse" />
        ) : null}
      </span>
      <span className="sr-only">{PHRASES[0]}</span>
    </span>
  )
}
