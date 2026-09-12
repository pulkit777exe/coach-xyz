'use client'

import { useRef } from 'react'
import Link from 'next/link'
import ChatPanel from '@/components/ChatPanel'
import { VideoPlayer, type VideoPlayerHandle } from '@/components/VideoPlayer'
import type { JobStatus } from '@/types'

interface ChatLayoutProps {
  jobId: string
  jobStatus: JobStatus | null
  onBackToResults: () => void
}

export default function ChatLayout({ jobId, jobStatus, onBackToResults }: ChatLayoutProps) {
  const videoRef = useRef<VideoPlayerHandle>(null)

  const handleSeekTo = (timestamp: number) => {
    videoRef.current?.seekTo(timestamp)
  }

  return (
    <div className="flex h-screen flex-col bg-(--bg)">
      {/* Header */}
      <header className="shrink-0 border-b border-(--cream-05) bg-(--bg)/80 backdrop-blur-md z-50">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4 lg:px-6">
          <Link href="/" className="font-serif text-lg text-(--fg)">coach.xyz</Link>
          <div className="flex items-center gap-4">
            <button
              onClick={onBackToResults}
              className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
            >
              ← Results
            </button>
            <Link
              href="/"
              className="text-[0.65rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
            >
              New Analysis
            </Link>
          </div>
        </div>
      </header>

      {/* Split Screen */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Video + Stats (desktop) */}
        <div className="hidden lg:flex lg:w-[45%] xl:w-[50%] flex-col border-r border-(--cream-05)">
          {/* Video Player */}
          <div className="flex-1 min-h-0">
            <VideoPlayer ref={videoRef} jobId={jobId} summary={jobStatus?.summary} />
          </div>

          {/* Stats Bar */}
          {jobStatus?.summary && (
            <div className="shrink-0 border-t border-(--cream-05) px-6 py-3">
              <div className="flex items-center gap-6 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-(--cream-40) uppercase tracking-wider">Score</span>
                  <span className="font-serif text-lg text-(--fg)">{jobStatus.summary.form_score}/10</span>
                </div>
                <div className="h-4 w-px bg-(--cream-10)" />
                <div className="flex items-center gap-2">
                  <span className="text-(--cream-40) uppercase tracking-wider">Events</span>
                  <span className="font-serif text-lg text-(--fg)">{jobStatus.summary.total_events}</span>
                </div>
                <div className="h-4 w-px bg-(--cream-10)" />
                <div className="flex items-center gap-2">
                  <span className="text-(--cream-40) uppercase tracking-wider">Rating</span>
                  <span className="font-serif text-lg text-(--fg) capitalize">{jobStatus.summary.overall_rating}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile: Video (using VideoPlayer for seekTo support) */}
          <div className="lg:hidden shrink-0 border-b border-(--cream-05)">
            <div className="aspect-video w-full">
              <VideoPlayer ref={videoRef} jobId={jobId} summary={jobStatus?.summary} />
            </div>
          </div>

          {/* Chat Panel */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatPanel jobId={jobId} jobStatus={jobStatus} onSeekTo={handleSeekTo} />
          </div>
        </div>
      </div>
    </div>
  )
}
