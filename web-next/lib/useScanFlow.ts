'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { scanVideoWithProgress, streamScanProgress, type CoachAIError } from '@/lib/api'
import { engineError, toCoachAIError } from '@/lib/errors'
import type { ScanResult, UploadProgress } from '@/types'
import { MAX_FILE_SIZE_BYTES } from '@/types'

// ── Shared scan flow ─────────────────────────────────────────────────────────
// The scan phase (validate → upload → SSE progress → player select → angle
// management) previously lived twice: once in usePipeline (coach flow) and
// once inline in PlayerHub's AnalyzeVideoCard (player flow). Fixes to one
// (attribution headers, angle passthrough, abort handling) had to be
// replayed in the other. This module owns the scan-phase state machine;
// callers own what happens after player selection via onAnalyze (coach:
// startAnalysis + poll + navigate; player: meStartAnalysis + poll + toast).

export type ScanPhase = 'idle' | 'uploading' | 'scanning' | 'selecting' | 'analyzing' | 'error'

export interface ScanFlowOptions {
  auth0Id: string | null
  /** Kick off analysis for a scanned perspective + player. The signal is
   * aborted when a newer scan, reset, or unmount supersedes the request.
   * Rejections are reported back to this module (error state) AND rethrown
   * so callers can react (their own error/toast handling). */
  onAnalyze: (
    scan: ScanResult,
    playerIndex: number,
    signal: AbortSignal,
  ) => void | Promise<void>
}

export interface ScanFlow {
  phase: ScanPhase
  uploadProgress: UploadProgress | null
  scanResult: ScanResult | null
  angleScans: ScanResult[]
  activeAngle: string
  selectedPlayerIndex: number | null
  errorStatus: CoachAIError | null
  handleFileSelected: (file: File) => void
  handleAddAngle: (file: File, angle: string) => void
  handleAngleChange: (angle: string) => void
  handlePlayerSelected: (playerIndex: number) => void
  reset: () => void
  revive: () => void
}

const invalidTypeError = (): CoachAIError => ({
  code: 'INVALID_TYPE',
  message: 'Please select a valid video file.',
  layer: 'client',
  retryable: false,
})

const tooLargeError = (): CoachAIError => ({
  code: 'FILE_TOO_LARGE',
  message: 'File size must be less than 500MB.',
  layer: 'client',
  retryable: false,
})

export function useScanFlow({ auth0Id, onAnalyze }: ScanFlowOptions): ScanFlow {
  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [angleScans, setAngleScans] = useState<ScanResult[]>([])
  const [activeAngle, setActiveAngle] = useState<string>('primary')
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [errorStatus, setErrorStatus] = useState<CoachAIError | null>(null)

  const mountedRef = useRef(true)
  const analysisAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      analysisAbortRef.current?.abort()
    }
  }, [])

  // Supersede generation: starting a new scan (or reset) fences every
  // in-flight run — double file-selects and reset-during-upload no longer
  // interleave state (stale success/error clobbering the live run). The
  // fenced run still finishes its upload silently in the background; only
  // state writes are fenced, via the live() check below. The same generation
  // also gates the analysis enqueue, and its AbortController cancels the
  // request when a newer scan/reset supersedes it.
  const scanGenerationRef = useRef(0)

  const fail = useCallback((e: unknown) => {
    if (!mountedRef.current) return
    setErrorStatus(toCoachAIError(e))
    setPhase('error')
    setUploadProgress(null)
  }, [])

  /**
   * Run one scan round (initial upload or an appended camera angle) with
   * event-driven progress: XHR upload events, then the engine SSE feed. No
   * polling — every state push arrives as an event.
   */
  const runScan = useCallback(
    async (
      file: File,
      append?: { sessionToken: string; angle: string },
    ): Promise<ScanResult | null> => {
      analysisAbortRef.current?.abort()
      analysisAbortRef.current = null
      const gen = ++scanGenerationRef.current
      const live = () => mountedRef.current && scanGenerationRef.current === gen
      setPhase(append ? 'scanning' : 'uploading')
      setUploadProgress({ phase: 'uploading', percent: 0 })

      // AbortController for scan progress SSE stream
      const scanAbort = new AbortController()

      try {
        const result = await scanVideoWithProgress(
          file,
          (progress) => {
            if (live()) setUploadProgress(progress)
          },
          auth0Id,
          append ? { sessionToken: append.sessionToken, angle: append.angle } : {},
        )
        if (!live()) return null

        // Upload done — transition to scanning phase
        setPhase('scanning')
        setUploadProgress({ phase: 'scanning', percent: 0 })

        // Stream real scan progress from engine via SSE (per-angle slot)
        try {
          for await (const event of streamScanProgress(
            result.session_token,
            scanAbort.signal,
            result.angle ?? append?.angle ?? null,
          )) {
            if (!live()) return null
            if (event.total > 0) {
              const percent = Math.round((event.current / event.total) * 100)
              setUploadProgress({ phase: 'scanning', percent })
            }
            if (event.complete) {
              if (event.error) {
                throw engineError('SCAN_FAILED', event.error)
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

        return live() ? result : null
      } catch (err: unknown) {
        // A fenced run's failure must not clobber the live run's state —
        // swallow it here; the live run owns the UI from this point on.
        if (!live()) return null
        throw err
      } finally {
        scanAbort.abort()
      }
    },
    [auth0Id],
  )

  /** Enter the analyzing phase and delegate kickoff to the caller. */
  const beginAnalyze = useCallback(
    async (scan: ScanResult, playerIndex: number) => {
      const gen = scanGenerationRef.current
      const controller = new AbortController()
      const live = () =>
        mountedRef.current && scanGenerationRef.current === gen && !controller.signal.aborted
      analysisAbortRef.current?.abort()
      analysisAbortRef.current = controller

      if (!live()) return
      setSelectedPlayerIndex(playerIndex)
      setPhase('analyzing')
      setUploadProgress(null)

      try {
        await onAnalyze(scan, playerIndex, controller.signal)
      } catch (e: unknown) {
        // A reset/new scan/unmount owns the UI now. Do not let its cancelled
        // enqueue write a stale error or resurrect job state; importantly, the
        // signal above also lets the HTTP request itself stop early.
        if (!live()) return
        setErrorStatus(toCoachAIError(e))
        setPhase('error')
        throw e
      } finally {
        if (analysisAbortRef.current === controller) analysisAbortRef.current = null
      }
    },
    [onAnalyze],
  )

  const handleFileSelected = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/')) {
        fail(invalidTypeError())
        return
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        fail(tooLargeError())
        return
      }

      try {
        const result = await runScan(file)
        // Null means fenced (superseded or unmounted) — the live run (or
        // nothing, if unmounted) owns the UI; write nothing here.
        if (!result) return

        setScanResult(result)
        setAngleScans([result])
        setActiveAngle(result.angle ?? 'primary')
        setUploadProgress(null)

        if (result.player_count === 1) {
          const playerIdx = result.players[0]?.player_index ?? 1
          await beginAnalyze(result, playerIdx)
        } else {
          setPhase('selecting')
        }
      } catch (e: unknown) {
        fail(e)
      }
    },
    [runScan, beginAnalyze, fail],
  )

  const handleAddAngle = useCallback(
    async (file: File, angle: string) => {
      if (!scanResult) return
      if (!file.type.startsWith('video/') || file.size > MAX_FILE_SIZE_BYTES) {
        fail(file.type.startsWith('video/') ? tooLargeError() : invalidTypeError())
        return
      }

      try {
        const result = await runScan(file, {
          sessionToken: scanResult.session_token,
          angle,
        })
        if (!result) return
        const label = result.angle ?? angle
        setAngleScans((prev) => {
          const next = prev.filter((s) => (s.angle ?? 'primary') !== label)
          return [...next, result]
        })
        setScanResult(result)
        setActiveAngle(label)
        setUploadProgress(null)
        setPhase('selecting')
      } catch (e: unknown) {
        fail(e)
      }
    },
    [scanResult, runScan, fail],
  )

  const handleAngleChange = useCallback((angle: string) => {
    setActiveAngle(angle)
    setSelectedPlayerIndex(null)
  }, [])

  const handlePlayerSelected = useCallback(
    async (playerIndex: number) => {
      const active = angleScans.find((s) => (s.angle ?? 'primary') === activeAngle) ?? scanResult
      if (!active) return
      try {
        await beginAnalyze(active, playerIndex)
      } catch {
        // Error state already recorded by beginAnalyze; callers that passed
        // onAnalyze observe the rejection through their own handling.
      }
    },
    [angleScans, activeAngle, scanResult, beginAnalyze],
  )

  const reset = useCallback(() => {
    // Fence in-flight runs first: their late completions must not
    // repopulate the cleared state. Abort an enqueue that is still waiting
    // on the network as well as guarding its eventual state writes.
    scanGenerationRef.current += 1
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null
    setPhase('idle')
    setScanResult(null)
    setAngleScans([])
    setActiveAngle('primary')
    setSelectedPlayerIndex(null)
    setErrorStatus(null)
    setUploadProgress(null)
  }, [])

  /**
   * Return to the selecting screen after a recoverable error without
   * discarding the scans (used by retry flows). No-op unless errored.
   */
  const revive = useCallback(() => {
    setErrorStatus(null)
    setPhase((prev) => (prev === 'error' ? 'selecting' : prev))
  }, [])

  return useMemo<ScanFlow>(
    () => ({
      phase,
      uploadProgress,
      scanResult,
      angleScans,
      activeAngle,
      selectedPlayerIndex,
      errorStatus,
      handleFileSelected,
      handleAddAngle,
      handleAngleChange,
      handlePlayerSelected,
      reset,
      revive,
    }),
    // Every value above is state or a stable useCallback — the memoized
    // identity keeps parent-constructed callbacks (handleRetry et al) and
    // downstream memos from invalidating on unrelated renders.
    [
      phase,
      uploadProgress,
      scanResult,
      angleScans,
      activeAngle,
      selectedPlayerIndex,
      errorStatus,
      handleFileSelected,
      handleAddAngle,
      handleAngleChange,
      handlePlayerSelected,
      reset,
      revive,
    ],
  )
}
