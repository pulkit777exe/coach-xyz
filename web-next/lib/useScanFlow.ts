'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { scanVideoWithProgress, streamScanProgress } from '@/lib/scan'
import type { CoachAIError } from '@/types'
import { clientError, engineError, toCoachAIError } from '@/lib/errors'
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
  /** Kick off analysis for a scanned perspective + player. Rejections are
   * reported back to this module (error state) AND rethrown so callers can
   * react (their own error/toast handling). */
  onAnalyze: (scan: ScanResult, playerIndex: number) => void | Promise<void>
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

const invalidTypeError = (): CoachAIError =>
  clientError('INVALID_TYPE', 'Please select a valid video file.')

const tooLargeError = (): CoachAIError =>
  clientError('FILE_TOO_LARGE', 'File size must be less than 500MB.')

export function useScanFlow({ auth0Id, onAnalyze }: ScanFlowOptions): ScanFlow {
  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [angleScans, setAngleScans] = useState<ScanResult[]>([])
  const [activeAngle, setActiveAngle] = useState<string>('primary')
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number | null>(null)
  const [errorStatus, setErrorStatus] = useState<CoachAIError | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
    async (file: File, append?: { sessionToken: string; angle: string }): Promise<ScanResult> => {
      setPhase(append ? 'scanning' : 'uploading')
      setUploadProgress({ phase: 'uploading', percent: 0 })

      // AbortController for scan progress SSE stream
      const scanAbort = new AbortController()

      try {
        const result = await scanVideoWithProgress(
          file,
          (progress) => {
            if (mountedRef.current) setUploadProgress(progress)
          },
          auth0Id,
          append ? { sessionToken: append.sessionToken, angle: append.angle } : {},
        )

        // Upload done — transition to scanning phase
        if (mountedRef.current) {
          setPhase('scanning')
          setUploadProgress({ phase: 'scanning', percent: 0 })
        }

        // Stream real scan progress from engine via SSE (per-angle slot)
        try {
          for await (const event of streamScanProgress(
            result.session_token,
            scanAbort.signal,
            result.angle ?? append?.angle ?? null,
          )) {
            if (event.total > 0) {
              const percent = Math.round((event.current / event.total) * 100)
              if (mountedRef.current) setUploadProgress({ phase: 'scanning', percent })
            }
            if (event.complete) {
              if (event.error) {
                throw engineError('SCAN_FAILED', event.error, true)
              }
              break
            }
          }
        } catch (err: unknown) {
          // If aborted (e.g., unmount), don't throw
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw clientError('REQUEST_TIMEOUT', 'Scan cancelled.')
          }
          throw err
        }

        return result
      } finally {
        scanAbort.abort()
      }
    },
    [auth0Id],
  )

  /** Enter the analyzing phase and delegate kickoff to the caller. */
  const beginAnalyze = useCallback(
    async (scan: ScanResult, playerIndex: number) => {
      if (mountedRef.current) {
        setSelectedPlayerIndex(playerIndex)
        setPhase('analyzing')
        setUploadProgress(null)
      }
      try {
        await onAnalyze(scan, playerIndex)
      } catch (e: unknown) {
        if (mountedRef.current) {
          setErrorStatus(toCoachAIError(e))
          setPhase('error')
        }
        throw e
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
        if (!mountedRef.current) return

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
        if (!mountedRef.current) return
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
      const active =
        angleScans.find((s) => (s.angle ?? 'primary') === activeAngle) ?? scanResult
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

  return {
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
  }
}
