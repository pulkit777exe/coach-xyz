import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startJobPolling } from "../jobPolling"
import type { JobStatus } from "@/types"

const mkStatus = (complete: boolean): JobStatus => ({
  job_id: "j1",
  state: "analyzing",
  stage: 1,
  stage_name: "Analyzing",
  progress: complete ? 100 : 20,
  complete,
  summary: null,
  video_ready: false,
  error: null,
  error_code: null,
  retryable: true,
})

const NETWORK_ERROR = {
  code: "NETWORK_ERROR",
  message: "Cannot connect to server.",
  layer: "client",
  retryable: true,
} as const

const FATAL_ERROR = {
  code: "VIDEO_EXPIRED",
  message: "Expired.",
  layer: "engine",
  retryable: false,
} as const

const flush = () => Promise.resolve()

let fetchStatus: ReturnType<typeof vi.fn<(jobId: string) => Promise<JobStatus>>>

beforeEach(() => {
  vi.useFakeTimers()
  fetchStatus = vi.fn<(jobId: string) => Promise<JobStatus>>()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("startJobPolling", () => {
  it("polls immediately and reports each status", async () => {
    fetchStatus.mockResolvedValue(mkStatus(false))
    const onStatus = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      onStatus,
    })
    await flush()

    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenCalledTimes(2)

    c.stop()
  })

  it("completes once isComplete becomes true and stops polling", async () => {
    fetchStatus
      .mockResolvedValueOnce(mkStatus(false))
      .mockResolvedValueOnce(mkStatus(true))
    const onStatus = vi.fn()
    const onComplete = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      onStatus,
      onComplete,
    })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].complete).toBe(true)

    await vi.advanceTimersByTimeAsync(10 * 2000)
    expect(fetchStatus).toHaveBeenCalledTimes(2) // no further polls

    c.stop()
  })

  it("retries transient errors with backoff, then reports success", async () => {
    fetchStatus
      .mockRejectedValueOnce(NETWORK_ERROR)
      .mockRejectedValueOnce(NETWORK_ERROR)
      .mockResolvedValueOnce(mkStatus(false))
      .mockResolvedValueOnce(mkStatus(true))
    const onTransient = vi.fn()
    const onError = vi.fn()
    const onStatus = vi.fn()
    const onComplete = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: 2000,
      onTransient,
      onError,
      onStatus,
      onComplete,
    })
    await flush()

    expect(onError).not.toHaveBeenCalled()
    expect(onTransient).toHaveBeenCalledTimes(1)
    expect(onTransient.mock.calls[0][0].attempts).toBe(1)
    expect(onTransient.mock.calls[0][0].hadSucceeded).toBe(false)

    // backoff: 2s * 2^(1-1) = 2s -> 2s * 2^1 = 4s
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(onTransient).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(4000)
    expect(onStatus).toHaveBeenCalledTimes(1)
    expect(onTransient).toHaveBeenCalledTimes(2) // reset after success

    await vi.advanceTimersByTimeAsync(2000)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()

    c.stop()
  })

  it("gives up permanently after maxFailures consecutive transient errors", async () => {
    fetchStatus.mockRejectedValue(NETWORK_ERROR)
    const onTransient = vi.fn()
    const onError = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: 1000,
      maxFailures: 3,
      backoffFactor: 1,
      onTransient,
      onError,
    })
    await flush()

    expect(onError).not.toHaveBeenCalled()
    expect(onTransient).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onTransient).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe("permanent")
    expect(onError.mock.calls[0][0].error.code).toBe("NETWORK_ERROR")
    expect(onError.mock.calls[0][0].hadSucceeded).toBe(false)

    await vi.advanceTimersByTimeAsync(10 * 1000)
    expect(fetchStatus).toHaveBeenCalledTimes(3) // stopped

    c.stop()
  })

  it("gives up immediately on a non-retryable error", async () => {
    fetchStatus.mockRejectedValue(FATAL_ERROR)
    const onError = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      onTransient: () => {},
      onError,
    })
    await flush()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe("permanent")
    expect(onError.mock.calls[0][0].error.retryable).toBe(false)

    c.stop()
  })

  it("gives up on the first failure when giveUpOnFirstFailure is set", async () => {
    fetchStatus.mockRejectedValue(NETWORK_ERROR)
    const onError = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      giveUpOnFirstFailure: true,
      onTransient: () => {},
      onError,
    })
    await flush()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].hadSucceeded).toBe(false)

    c.stop()
  })

  it("fires a timeout error after timeoutMs elapses", async () => {
    fetchStatus.mockResolvedValue(mkStatus(false))
    const onError = vi.fn()
    const onComplete = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: 1000,
      timeoutMs: 5000,
      onError,
      onComplete,
    })
    await flush()
    expect(onError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(6000)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe("timeout")
    expect(onError.mock.calls[0][0].error.code).toBe("ANALYSIS_TIMEOUT")
    expect(onComplete).not.toHaveBeenCalled()

    const callsAtTimeout = fetchStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * 1000)
    expect(fetchStatus.mock.calls.length).toBe(callsAtTimeout) // stopped

    c.stop()
  })

  it("fires the stuck warning once warnAfterMs elapses", async () => {
    fetchStatus.mockResolvedValue(mkStatus(false))
    const onWarn = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: 2000,
      warnAfterMs: 5000,
      onWarn,
    })
    await flush()
    expect(onWarn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3 * 2000) // 6s elapsed
    expect(onWarn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30 * 2000)
    expect(onWarn).toHaveBeenCalledTimes(1) // only once

    c.stop()
  })

  it("stop() halts polling and drops in-flight results", async () => {
    let resolveStatus: (s: JobStatus) => void
    fetchStatus.mockImplementation(() => new Promise<JobStatus>((res) => { resolveStatus = res }))
    const onStatus = vi.fn()
    const onError = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      onStatus,
      onError,
    })
    await flush()

    c.stop()
    resolveStatus!(mkStatus(false))
    await flush()

    expect(onStatus).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10 * 2000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it("refresh() re-polls immediately and resets the timeout clock", async () => {
    fetchStatus.mockResolvedValue(mkStatus(false))
    const onStatus = vi.fn()
    const onError = vi.fn()

    const c = startJobPolling({
      jobId: "j1",
      fetchStatus,
      isComplete: (s) => s.complete,
      intervalMs: 2000,
      timeoutMs: 5000,
      onStatus,
      onError,
    })
    await flush()
    expect(onStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4000) // polls at t=2000 and t=4000
    expect(onStatus).toHaveBeenCalledTimes(3)

    c.refresh()
    await flush()
    expect(onStatus).toHaveBeenCalledTimes(4)

    // Without refresh the 5s deadline would have passed at t=5500;
    // after refresh the clock restarts from t=4000.
    await vi.advanceTimersByTimeAsync(1500)
    expect(onError).not.toHaveBeenCalled()

    c.stop()
  })
})