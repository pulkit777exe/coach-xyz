'use client'

import {
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useMemo,
} from 'react'
import { Slide } from 'loading-dev'
import { getAuthorizedDownloadUrl, getDownloadUrl } from '@/lib/api'
import type { AnalysisSummary, ShotEvent } from '@/types'

interface VideoPlayerProps {
  jobId: string
  summary?: AnalysisSummary | null
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void
}

const CALLOUT_DURATION_MS = 2500
const CALLOUT_FADE_MS = 400
const TIMELINE_H = 32
const MARKER_W = 3

function _scoreColor(score: number): string {
  if (score >= 8) return '#3cdc5a'
  if (score >= 5) return '#fbbf24'
  return '#ef4444'
}

function _eventTypeLabel(eventType: string): string {
  const map: Record<string, string> = {
    made: 'Made',
    missed: 'Missed',
    ace: 'Ace',
    fault: 'Fault',
    goal: 'Goal',
    save: 'Save',
    strike: 'Strike',
    ball: 'Ball',
    single: 'Single',
    double: 'Double',
    six: 'Six',
    wicket: 'Wicket',
  }
  return map[eventType] || eventType.replace(/_/g, ' ')
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { jobId, summary },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false)
  const [hoverX, setHoverX] = useState(0)
  // Owned jobs require the signed attribution token, which a <video> tag
  // cannot send as a header — resolve the query-token URL per job.
  const [videoSrc, setVideoSrc] = useState(() => getDownloadUrl(jobId))
  const [videoSrcJob, setVideoSrcJob] = useState(jobId)
  if (videoSrcJob !== jobId) {
    setVideoSrcJob(jobId)
    setVideoSrc(getDownloadUrl(jobId))
  }
  useEffect(() => {
    let cancelled = false
    void getAuthorizedDownloadUrl(jobId).then((url) => {
      if (!cancelled) setVideoSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [jobId])
  const activeCallouts = useRef<Array<{ event: ShotEvent; startMs: number; opacity: number }>>([])
  const lastCalloutIndex = useRef<number>(-1)
  const animFrameRef = useRef<number>(0)

  const shotEvents = useMemo(() => summary?.shot_events ?? [], [summary])

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

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cw = canvas.width / (window.devicePixelRatio || 1)
    const ch = canvas.height / (window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, cw, ch)

    const now = video.currentTime
    const dur = video.duration
    if (!dur || !isFinite(dur)) return

    const barH = TIMELINE_H
    const barY = ch - barH
    const barPad = 8
    const barLeft = barPad
    const barRight = cw - barPad
    const barWidth = barRight - barLeft

    // Timeline track background
    ctx.fillStyle = 'rgba(20,20,20,0.7)'
    ctx.fillRect(0, barY, cw, barH)

    // Progress track (dark)
    ctx.fillStyle = 'rgba(60,60,60,0.8)'
    ctx.beginPath()
    ctx.roundRect(barLeft, barY + 10, barWidth, 6, 3)
    ctx.fill()

    // Progress fill
    const progress = Math.max(0, Math.min(1, now / dur))
    const fillW = barWidth * progress
    if (fillW > 0) {
      ctx.fillStyle = 'rgba(0,165,255,0.9)'
      ctx.beginPath()
      ctx.roundRect(barLeft, barY + 10, fillW, 6, 3)
      ctx.fill()
    }

    // Event markers
    if (shotEvents.length > 0) {
      for (const evt of shotEvents) {
        const t = evt.timestamp
        if (t < 0 || t > dur) continue
        const x = barLeft + (t / dur) * barWidth
        ctx.fillStyle = _scoreColor(evt.form_score)
        ctx.beginPath()
        ctx.roundRect(x - MARKER_W / 2, barY + 6, MARKER_W, 14, 1)
        ctx.fill()
      }
    }

    // Playhead
    const phX = barLeft + fillW
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(phX, barY + 13, 5, 0, Math.PI * 2)
    ctx.fill()

    // Current time label (top-right)
    const tsText = `${now.toFixed(1)}s`
    ctx.font = '12px system-ui, sans-serif'
    const tsW = ctx.measureText(tsText).width
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.beginPath()
    ctx.roundRect(cw - tsW - 20, 8, tsW + 12, 22, 4)
    ctx.fill()
    ctx.fillStyle = 'rgba(220,220,220,0.9)'
    ctx.fillText(tsText, cw - tsW - 14, 24)

    // Hover tooltip
    if (isHoveringTimeline) {
      const hx = Math.max(barLeft, Math.min(barRight, hoverX))
      const ht = ((hx - barLeft) / barWidth) * dur

      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(hx, barY + 6)
      ctx.lineTo(hx, barY + 20)
      ctx.stroke()
      ctx.setLineDash([])

      const tText = `${ht.toFixed(1)}s`
      ctx.font = '11px system-ui, sans-serif'
      const tTW = ctx.measureText(tText).width
      ctx.fillStyle = 'rgba(30,30,30,0.9)'
      ctx.beginPath()
      ctx.roundRect(hx - tTW / 2 - 4, barY - 18, tTW + 8, 16, 3)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(tText, hx - tTW / 2, barY - 6)
    }

    // Active callouts
    const nowMs = performance.now()
    activeCallouts.current = activeCallouts.current.filter((c) => {
      const elapsed = nowMs - c.startMs
      if (elapsed > CALLOUT_DURATION_MS) return false
      const fadeIn = Math.min(1, elapsed / CALLOUT_FADE_MS)
      const fadeOut = Math.min(1, (CALLOUT_DURATION_MS - elapsed) / CALLOUT_FADE_MS)
      c.opacity = Math.min(fadeIn, fadeOut)
      return true
    })

    for (const callout of activeCallouts.current) {
      const label = `${_eventTypeLabel(callout.event.event_type)} — ${callout.event.form_score}/10`
      ctx.globalAlpha = callout.opacity

      ctx.font = 'bold 13px system-ui, sans-serif'
      const labelW = ctx.measureText(label).width
      const pillW = labelW + 20
      const pillH = 28
      const pillX = (cw - pillW) / 2
      const pillY = ch / 2 - 80

      ctx.fillStyle = 'rgba(10,10,10,0.75)'
      ctx.beginPath()
      ctx.roundRect(pillX, pillY, pillW, pillH, 6)
      ctx.fill()

      ctx.fillStyle = _scoreColor(callout.event.form_score)
      ctx.beginPath()
      ctx.roundRect(pillX, pillY, 4, pillH, 2)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, pillX + 12, pillY + 19)
      ctx.globalAlpha = 1
    }
  }, [shotEvents, isHoveringTimeline, hoverX])

  // Animation loop
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let running = true

    const tick = () => {
      if (!running) return
      drawOverlay()
      animFrameRef.current = requestAnimationFrame(tick)
    }

    const onPlay = () => {
      running = true
      tick()
    }
    const onPause = () => {
      running = false
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    tick()

    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
    }
  }, [drawOverlay])

  // Trigger callouts when passing event timestamps
  useEffect(() => {
    const video = videoRef.current
    if (!video || shotEvents.length === 0) return

    const onTimeUpdate = () => {
      const t = video.currentTime
      for (let i = 0; i < shotEvents.length; i++) {
        const evt = shotEvents[i]
        if (evt.timestamp > t - 0.3 && evt.timestamp <= t && i !== lastCalloutIndex.current) {
          lastCalloutIndex.current = i
          activeCallouts.current.push({ event: evt, startMs: performance.now(), opacity: 0 })
          break
        }
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [shotEvents])

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    const timeline = timelineRef.current
    if (!video || !timeline || !video.duration) return

    const rect = timeline.getBoundingClientRect()
    const x = e.clientX - rect.left
    const barPad = 8
    const barWidth = rect.width - barPad * 2

    if (x < barPad || x > rect.width - barPad) return
    const time = ((x - barPad) / barWidth) * video.duration
    video.currentTime = Math.max(0, Math.min(video.duration, time))
    video.play().catch(() => {})
  }

  const handleTimelineMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const timeline = timelineRef.current
    if (!timeline) return
    const rect = timeline.getBoundingClientRect()
    const x = e.clientX - rect.left
    const barPad = 8

    if (x >= barPad && x <= rect.width - barPad) {
      setHoverX(x)
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[6px] border border-border bg-black"
    >
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"
            />
          </svg>
          <span className="text-meta text-white/70">Video unavailable</span>
        </div>
      )}
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Slide size={24} className="text-white/85" />
        </div>
      )}
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        className={`max-h-full max-w-full object-contain ${hasError ? 'hidden' : ''}`}
        preload="metadata"
        onLoadStart={() => setIsLoading(true)}
        onLoadedData={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false)
          setHasError(true)
        }}
      >
        Your browser does not support the video tag.
      </video>

      {/* Canvas overlay — drawing only, no pointer events */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 pointer-events-none ${hasError ? 'hidden' : ''}`}
        style={{ zIndex: 10 }}
      />

      {/* Timeline interaction layer — sits at the bottom, above video controls */}
      <div
        ref={timelineRef}
        className="absolute bottom-0 left-0 right-0 cursor-pointer"
        style={{ height: TIMELINE_H, zIndex: 11 }}
        onClick={handleTimelineClick}
        onMouseEnter={() => setIsHoveringTimeline(true)}
        onMouseLeave={() => setIsHoveringTimeline(false)}
        onMouseMove={handleTimelineMove}
      />
    </div>
  )
})
