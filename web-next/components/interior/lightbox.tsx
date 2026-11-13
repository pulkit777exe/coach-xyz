'use client'

import { useEffect, useId, useRef } from 'react'
import Image from 'next/image'
import { XIcon } from 'lucide-react'
import { focusInitial, inertOutside, restoreFocusOnClose } from './overlay-a11y'

interface LightboxProps {
  open: boolean
  onClose: () => void
  src: string
  alt: string
}

export function Lightbox({ open, onClose, src, alt }: LightboxProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const undoFocus = restoreFocusOnClose(document)
    focusInitial(panelRef.current)
    const undoInert = inertOutside(rootRef.current, document.body)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      undoInert()
      undoFocus()
    }
  }, [open, onClose])

  if (!open || !src) return null

  const isVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(src) || src.includes('/download')

  return (
    <div ref={rootRef} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-zoom-out"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-full max-w-full outline-none"
      >
        <h2 id={titleId} className="sr-only">
          {alt ? `Preview: ${alt}` : 'Media preview'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-2 top-2 z-10 inline-flex size-10 items-center justify-center rounded-[6px] bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <XIcon className="size-5" aria-hidden="true" />
        </button>
        <figure className="relative max-h-full max-w-full">
          {isVideo ? (
            <video src={src} controls autoPlay className="max-h-[85vh] max-w-full" />
          ) : (
            <div className="relative h-[85vh] w-[85vw]">
              <Image unoptimized fill sizes="85vw" src={src} alt={alt} className="object-contain" />
            </div>
          )}
          <figcaption className="sr-only">{alt}</figcaption>
        </figure>
      </div>
    </div>
  )
}
