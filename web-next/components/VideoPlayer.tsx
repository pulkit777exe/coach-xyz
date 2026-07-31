'use client'

import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
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

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = time
          videoRef.current.play().catch(() => {})
        }
      },
    }))

    return (
      <div className="relative flex h-full w-full items-center justify-center bg-black">
        <video
          ref={videoRef}
          src={getDownloadUrl(jobId)}
          controls
          className="max-h-full max-w-full object-contain"
          preload="metadata"
        >
          Your browser does not support the video tag.
        </video>
      </div>
    )
  }
)
