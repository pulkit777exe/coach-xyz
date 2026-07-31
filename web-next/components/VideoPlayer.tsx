'use client'

import { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react'
import { getDownloadUrl } from '@/lib/api'

interface VideoPlayerProps {
  jobId: string
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ jobId }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = time
          videoRef.current.play().catch(() => {})
        }
      },
    }))

    useEffect(() => {
      setIsLoading(true)
      setHasError(false)
    }, [jobId])

    return (
      <div className="relative flex h-full w-full items-center justify-center bg-black">
        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--cream-40)]">
            <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
            </svg>
            <span className="text-xs">Video unavailable</span>
          </div>
        )}
        {isLoading && !hasError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--cream-20)] border-t-transparent" />
          </div>
        )}
        <video
          ref={videoRef}
          src={getDownloadUrl(jobId)}
          controls
          className={`max-h-full max-w-full object-contain ${hasError ? 'hidden' : ''}`}
          preload="metadata"
          onLoadStart={() => setIsLoading(true)}
          onLoadedData={() => setIsLoading(false)}
          onError={() => { setIsLoading(false); setHasError(true) }}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    )
  }
)
