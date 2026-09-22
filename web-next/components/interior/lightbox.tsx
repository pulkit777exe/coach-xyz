'use client'

import { useEffect } from 'react'
import Image from 'next/image'

interface LightboxProps {
  open: boolean
  onClose: () => void
  src: string
  alt: string
}

export function Lightbox({ open, onClose, src, alt }: LightboxProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !src) return null

  const isVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(src) || src.includes('/download')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/90 p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-zoom-out"
      />
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
  )
}
