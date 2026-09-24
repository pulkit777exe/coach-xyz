'use client'

import { useRef } from 'react'
import Link from 'next/link'
import ChatPanel from '@/components/ChatPanel'
import ClipsSection from '@/components/ClipsSection'
import FindingsTimeline from '@/components/FindingsTimeline'
import { VideoPlayer, type VideoPlayerHandle } from '@/components/VideoPlayer'
import { reviewFinding } from '@/lib/api'
import type { JobStatus } from '@/types'

interface ChatLayoutProps {
  auth0Id: string | null
  jobId: string
  jobStatus: JobStatus | null
  onBackToResults: () => void
}

export default function ChatLayout({
  auth0Id,
  jobId,
  jobStatus,
  onBackToResults,
}: ChatLayoutProps) {
  const videoRef = useRef<VideoPlayerHandle>(null)

  const handleSeekTo = (timestamp: number) => {
    videoRef.current?.seekTo(timestamp)
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-background z-50">
        {/* No brand here — the global topbar owns the app name (one place). */}
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-end px-4 lg:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={onBackToResults}
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded"
            >
              ← Results
            </button>
            <Link
              href="/"
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              New Analysis
            </Link>
          </div>
        </div>
      </header>

      {/* Split Screen */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Video + Stats (desktop) */}
        <div className="hidden lg:flex lg:w-[45%] xl:w-[50%] flex-col border-r border-border">
          {/* Video Player */}
          <div className="flex-1 min-h-0">
            <VideoPlayer ref={videoRef} jobId={jobId} summary={jobStatus?.summary} />
          </div>

          {/* Stats Bar */}
          {jobStatus?.summary && (
            <div className="shrink-0 border-t border-border px-6 py-3">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Score
                  </span>
                  <span className="font-semibold text-[20px] leading-none tabular-nums text-foreground">
                    {jobStatus.summary.form_score}/10
                  </span>
                </div>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Events
                  </span>
                  <span className="font-semibold text-[20px] leading-none tabular-nums text-foreground">
                    {jobStatus.summary.total_events}
                  </span>
                </div>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Rating
                  </span>
                  <span className="font-semibold text-[20px] leading-none text-foreground capitalize">
                    {jobStatus.summary.overall_rating}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Findings Timeline (click a finding to seek the video) */}
          {jobStatus?.summary?.findings && jobStatus.summary.findings.length > 0 && (
            <div className="shrink-0 border-t border-border px-4 py-3 max-h-72 overflow-y-auto">
              <FindingsTimeline
                findings={jobStatus.summary.findings}
                onSeek={handleSeekTo}
                onReview={
                  auth0Id
                    ? (findingId, state) => reviewFinding(auth0Id, findingId, state).then(() => {})
                    : undefined
                }
              />
            </div>
          )}

          {/* Clips (coach-curated subclip bookmarks, click to seek) */}
          <div className="shrink-0 border-t border-border max-h-72 overflow-y-auto">
            <ClipsSection auth0Id={auth0Id} jobId={jobId} onSeek={handleSeekTo} />
          </div>
        </div>

        {/* Right: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile: Video (using VideoPlayer for seekTo support) */}
          <div className="lg:hidden shrink-0 border-b border-border">
            <div className="aspect-video w-full">
              <VideoPlayer ref={videoRef} jobId={jobId} summary={jobStatus?.summary} />
            </div>
            {jobStatus?.summary?.findings && jobStatus.summary.findings.length > 0 && (
              <details className="border-t border-border px-4 py-2">
                <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground py-1">
                  Key findings (<span className="tabular-nums">{jobStatus.summary.findings.length}</span>)
                </summary>
                <div className="py-2 max-h-64 overflow-y-auto">
                  <FindingsTimeline
                    findings={jobStatus.summary.findings}
                    onSeek={handleSeekTo}
                    onReview={
                      auth0Id
                        ? (findingId, state) =>
                            reviewFinding(auth0Id, findingId, state).then(() => {})
                        : undefined
                    }
                  />
                </div>
              </details>
            )}
            <details className="border-t border-border px-4 py-2">
              <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground py-1">
                Clips
              </summary>
              <div className="py-2 max-h-64 overflow-y-auto">
                <ClipsSection auth0Id={auth0Id} jobId={jobId} onSeek={handleSeekTo} />
              </div>
            </details>
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
