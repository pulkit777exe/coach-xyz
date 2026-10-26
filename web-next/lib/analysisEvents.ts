import { startJobPolling, type JobPollingConfig } from './jobPolling'
import type { JobPollingController } from './jobPolling'
import type { JobStatus } from '@/types'

export type AnalysisStatusConfig = JobPollingConfig<JobStatus> & {
  /** Stops the loop when the owning view unmounts or the flow is reset. */
  signal?: AbortSignal
}

/**
 * Status tracking for one analysis job. The server exposes no live job-event
 * stream, so this is the poll loop itself: interval, backoff, timeout and the
 * stuck warning all come from `lib/jobPolling`.
 */
export function startAnalysisStatus(config: AnalysisStatusConfig): JobPollingController {
  const { signal, ...poll } = config
  const controller = startJobPolling(poll)
  if (signal) {
    if (signal.aborted) controller.stop()
    else signal.addEventListener('abort', () => controller.stop(), { once: true })
  }
  return controller
}
