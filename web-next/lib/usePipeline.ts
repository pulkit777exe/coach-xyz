'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { scanVideoWithProgress, streamScanProgress, startAnalysis, getJobStatus, type CoachAIError } from '@/lib/api'
import { toCoachAIError } from '@/lib/errors'
import { startJobPolling, type JobPollingController } from '@/lib/jobPolling'
import { mapEngineStateToPipeline } from '@/lib/pipelineState'
import type { PipelineState, ScanResult, JobStatus, UploadProgress } from '@/types'
import { MAX_FILE_SIZE_BYTES } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL

export interface PipelineActions {
  handleFileSelected: (file: File) => void
  handlePlayerSelected: (playerIndex: number) => void
  /** Upload another camera perspective into the current session. */
  handleAddAngle: (file: File, angle: string) => void
  /** Switch the selecting view between scanned perspectives. */
  handleAngleChange: (angle: string) => void
  handleRetry: () => void
  handleReset: () => void
  handleStartChat: () => void
  handleBackToResults: () => void
}

export interface Pipeline extends PipelineActions {
  pipelineState: PipelineState
  scanResult: ScanResult | null
  /** Every scanned perspective in this session (primary first). */
  angleScans: ScanResult[]
  /** Currently selected perspective label. */
  activeAngle: string
  selectedPlayerIndex: number | null
  jobId: string | null
  jobStatus: JobStatus | null
  errorStatus: CoachAIError | null
  uploadProgress: UploadProgress | null
}

export function usePipeline(auth0Id: string | null = null, initialJobId: string | null = null): Pipeline {
  const router = useRouter()
  const pathname = usePathname()
  const [pipelineState, setPipelineState] = useState<PipelineState>('idle')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [angleScans, setAngleScans] = useState<ScanResult[]>([])
  const [activeAngle, setActiveAngle] = useState<string>('primary')
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [errorStatus, setErrorStatus] = useState<CoachAIError | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)

  const pipelineStateRef = useRef<PipelineState>(pipelineState)
  const retryGenerationRef = useRef(0)

  // Keep ref in sync with state for use in callbacks without stale closures
  useEffect(() => { pipelineStateRef.current = pipelineState }, [pipelineState])

  // ── Keep-alive ping ────────────────────────────────────────────────────
  useEffect(() => {
    if (!BASE) return
    const ping = () => fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {})
    ping()
    const t = setInterval(ping, 8 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Polling ────────────────────────────────────────────────────────────
  const pollControllerRef = useRef<JobPollingController | null>(null)

  const stopPolling = useCallback(() => {
    pollControllerRef.current?.stop()
    pollControllerRef.current = null
  }, [])

  const startPolling = useCallback(
    (pollJobId: string) => {
      stopPolling()
      pollControllerRef.current = startJobPolling({
        jobId: pollJobId,
        fetchStatus: getJobStatus,
        isComplete: (status) => status.complete,
        intervalMs: 2000,
        timeoutMs: 12 * 60 * 1000,
        maxFailures: 5,
        // Job still in progress — safe to update status and stage display.
        // Cap the displayed progress at 99 while the job is not yet
        // complete, so the bar never reaches 100% on the loading screen.
        onStatus: (status) => {
          const displayStatus = status.progress >= 100
            ? { ...status, progress: 99 }
            : status
          setJobStatus(displayStatus)
          if (status.state) {
            setPipelineState(mapEngineStateToPipeline(status.state))
          }
        },
        onComplete: (status) => {
          if (status.error) {
            // Store the error status first, then flip pipeline state.
            // Never store a complete/100% jobStatus while still on the
            // progress screen — that's what causes the 100% flash.
            setErrorStatus({
              code: status.error_code ?? 'ANALYSIS_FAILED',
              message: status.error,
              layer: 'engine',
              retryable: status.retryable ?? true,
            })
            setJobStatus(status)
            setPipelineState('error')
          } else {
            // Flip pipeline state BEFORE writing jobStatus so that
            // AnalysisProgress never receives a status with progress=100.
            // React batches these two setState calls in the same render.
            setPipelineState('completed')
            setJobStatus(status)
          }
        },
        onError: (failure) => {
          setErrorStatus(failure.error)
          setPipelineState('error')
        },
      })
    },
    [stopPolling],
  )

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // ── Resume from initialJobId ────────────────────────────────────────────
  useEffect(() => {
    if (!initialJobId) return
    let cancelled = false

    const resume = async () => {
      try {
        const status = await getJobStatus(initialJobId)
        if (cancelled) return
        setJobId(initialJobId)
        if (status.complete) {
          if (status.error) {
            setErrorStatus({
              code: status.error_code ?? 'ANALYSIS_FAILED',
              message: status.error,
              layer: 'engine',
              retryable: status.retryable ?? true,
            })
            setJobStatus(status)
            setPipelineState('error')
          } else {
            setPipelineState('completed')
            setJobStatus(status)
          }
        } else {
          // Job still in progress — resume polling
          setJobStatus(status)
          if (status.state) {
            setPipelineState(mapEngineStateToPipeline(status.state))
          }
          startPolling(initialJobId)
        }
      } catch {
        if (cancelled) return
        setErrorStatus({
          code: 'JOB_NOT_FOUND',
          message: 'Could not resume analysis. It may have expired.',
          layer: 'client',
          retryable: false,
        })
        setPipelineState('error')
      }
    }

    resume()
    return () => { cancelled = true }
  }, [initialJobId, startPolling])

  // ── Handlers ───────────────────────────────────────────────────────────
  /**
   * Run one scan round (initial upload or an appended camera angle) with
   * event-driven progress: XHR upload events, then the engine SSE feed. No
   * polling — every state push arrives as an event.
   */
  const runScan = useCallback(async (
    file: File,
    append?: { sessionToken: string; angle: string },
  ): Promise<ScanResult> => {
    setPipelineState(append ? 'scanning' : 'uploading')
    setUploadProgress({ phase: 'uploading', percent: 0 })

    // AbortController for scan progress SSE stream
    const scanAbort = new AbortController()

    try {
      const result = await scanVideoWithProgress(
        file,
        (progress) => setUploadProgress(progress),
        auth0Id,
        append ? { sessionToken: append.sessionToken, angle: append.angle } : {},
      )

      // Upload done — transition to scanning phase
      setPipelineState('scanning')
      setUploadProgress({ phase: 'scanning', percent: 0 })

      // Stream real scan progress from engine via SSE (per-angle slot)
      try {
        for await (const event of streamScanProgress(
          result.session_token,
          scanAbort.signal,
          result.angle ?? append?.angle ?? null,
        )) {
          if (event.total > 0) {
            const percent = Math.round((event.current / event.total) * 100)
            setUploadProgress({ phase: 'scanning', percent })
          }
          if (event.complete) {
            if (event.error) {
              throw {
                code: 'SCAN_FAILED',
                message: event.error,
                layer: 'engine',
                retryable: true,
              } as CoachAIError
            }
            break
          }
        }
      } catch (err: unknown) {
        // If aborted (e.g., unmount), don't throw
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw {
            code: 'REQUEST_TIMEOUT',
            message: 'Scan cancelled.',
            layer: 'client',
            retryable: false,
          } as CoachAIError
        }
        throw err
      }

      return result
    } finally {
      scanAbort.abort()
    }
  }, [auth0Id])

  /** Kick off analysis for one scanned perspective + player. */
  const startAnalysisForScan = useCallback(async (scan: ScanResult, playerIndex: number) => {
    setSelectedPlayerIndex(playerIndex)
    setPipelineState('analyzing')
    setUploadProgress(null)
    const { job_id } = await startAnalysis({
      session_token: scan.session_token,
      player_index: playerIndex,
      video_key: scan.video_key,
      angle: scan.angle ?? null,
      auth0Id,
    })
    setJobId(job_id)
    startPolling(job_id)
    if (pathname !== `/dashboard/analysis/${job_id}`) {
      router.push(`/dashboard/analysis/${job_id}`)
    }
  }, [auth0Id, startPolling, router, pathname])

  const handleFileSelected = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setErrorStatus({
        code: 'INVALID_TYPE',
        message: 'Please select a valid video file.',
        layer: 'client',
        retryable: false,
      })
      setPipelineState('error')
      return
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorStatus({
        code: 'FILE_TOO_LARGE',
        message: 'File size must be less than 500MB.',
        layer: 'client',
        retryable: false,
      })
      setPipelineState('error')
      return
    }

    try {
      const result = await runScan(file)

      setScanResult(result)
      setAngleScans([result])
      setActiveAngle(result.angle ?? 'primary')
      setUploadProgress(null)

      if (result.player_count === 1) {
        const playerIdx = result.players[0]?.player_index ?? 1
        await startAnalysisForScan(result, playerIdx)
      } else {
        setPipelineState('selecting')
      }
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
      setUploadProgress(null)
    }
  }, [runScan, startAnalysisForScan])

  const handleAddAngle = useCallback(async (file: File, angle: string) => {
    if (!scanResult) return
    if (!file.type.startsWith('video/') || file.size > MAX_FILE_SIZE_BYTES) {
      setErrorStatus({
        code: file.type.startsWith('video/') ? 'FILE_TOO_LARGE' : 'INVALID_TYPE',
        message: file.type.startsWith('video/')
          ? 'File size must be less than 500MB.'
          : 'Please select a valid video file.',
        layer: 'client',
        retryable: false,
      })
      setPipelineState('error')
      return
    }

    try {
      const result = await runScan(file, {
        sessionToken: scanResult.session_token,
        angle,
      })
      const label = result.angle ?? angle
      setAngleScans((prev) => {
        const next = prev.filter((s) => (s.angle ?? 'primary') !== label)
        return [...next, result]
      })
      setScanResult(result)
      setActiveAngle(label)
      setUploadProgress(null)
      setPipelineState('selecting')
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
      setUploadProgress(null)
    }
  }, [scanResult, runScan])

  const handleAngleChange = useCallback((angle: string) => {
    setActiveAngle(angle)
    setSelectedPlayerIndex(null)
  }, [])

  const handlePlayerSelected = useCallback(async (playerIndex: number) => {
    const active = angleScans.find((s) => (s.angle ?? 'primary') === activeAngle)
      ?? scanResult
    if (!active) return
    try {
      await startAnalysisForScan(active, playerIndex)
    } catch (e: unknown) {
      setErrorStatus(toCoachAIError(e))
      setPipelineState('error')
    }
  }, [angleScans, activeAngle, scanResult, startAnalysisForScan])

  const handleRetry = useCallback(() => {
    stopPolling()

    if (scanResult && errorStatus?.retryable && errorStatus?.layer !== 'client') {
      setJobStatus(null)
      setErrorStatus(null)

      if (selectedPlayerIndex !== null) {
        setPipelineState('analyzing')
        const gen = ++retryGenerationRef.current
        startAnalysis({
          session_token: scanResult.session_token,
          player_index: selectedPlayerIndex,
          video_key: scanResult.video_key,
          angle: scanResult.angle ?? null,
          auth0Id,
        })
          .then(({ job_id }) => {
            // Don't start polling if pipeline was reset or another retry started
            if (pipelineStateRef.current === 'idle' || retryGenerationRef.current !== gen) return
            setJobId(job_id)
            startPolling(job_id)
            if (pathname !== `/dashboard/analysis/${job_id}`) {
              router.push(`/dashboard/analysis/${job_id}`)
            }
          })
          .catch((e: unknown) => {
            if (retryGenerationRef.current !== gen) return
            setErrorStatus(toCoachAIError(e))
            setPipelineState('error')
          })
      } else {
        setPipelineState('selecting')
      }
    } else {
      setPipelineState('idle')
      setScanResult(null)
      setAngleScans([])
      setActiveAngle('primary')
      setSelectedPlayerIndex(null)
      setJobId(null)
      setJobStatus(null)
      setErrorStatus(null)
      setUploadProgress(null)
    }
  }, [scanResult, selectedPlayerIndex, errorStatus, stopPolling, startPolling, auth0Id, router, pathname])

  const handleReset = useCallback(() => {
    stopPolling()
    setPipelineState('idle')
    setScanResult(null)
    setAngleScans([])
    setActiveAngle('primary')
    setSelectedPlayerIndex(null)
    setJobId(null)
    setJobStatus(null)
    setErrorStatus(null)
    setUploadProgress(null)
  }, [stopPolling])

  const handleStartChat = useCallback(() => {
    setPipelineState('chatting')
  }, [])

  const handleBackToResults = useCallback(() => {
    setPipelineState('completed')
  }, [])

  return {
    pipelineState,
    scanResult,
    angleScans,
    activeAngle,
    selectedPlayerIndex,
    jobId,
    jobStatus,
    errorStatus,
    uploadProgress,
    handleFileSelected,
    handlePlayerSelected,
    handleAddAngle,
    handleAngleChange,
    handleRetry,
    handleReset,
    handleStartChat,
    handleBackToResults,
  }
}
