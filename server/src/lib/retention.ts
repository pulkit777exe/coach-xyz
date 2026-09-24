// ── Retention sweep (§30) ───────────────────────────────────────────────────
// Governance/retention scheduling is not the video-analysis queue's concern,
// so the interval mechanism lives here. lib/queue.ts starts it from
// startQueueInfrastructure() under the same Redis-availability gate it had
// when the sweep lived inline there: daily interval (unref'd) plus a first
// run 60 seconds after start. Cadence and first-run delay are unchanged.

import { pruneRetention } from './analyses'
import { logger } from './logger'

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 60_000

async function pruneOldAnalyses(): Promise<void> {
  try {
    const pruned = await pruneRetention()
    if (pruned > 0) {
      logger.info('retention_pruned', { type: 'retention_pruned', analyses: pruned })
    }
  } catch (err) {
    logger.error('retention_prune_error', {
      type: 'retention_prune_error',
      error: String(err),
    })
  }
}

let retentionInterval: ReturnType<typeof setInterval> | null = null
let firstRunTimeout: ReturnType<typeof setTimeout> | null = null

/** Start the daily sweep + 60s first run. Idempotent — a second call while
 *  running is a no-op. */
export function startRetentionSweep(): void {
  if (retentionInterval) return
  const interval = setInterval(pruneOldAnalyses, SWEEP_INTERVAL_MS)
  interval.unref()
  retentionInterval = interval
  firstRunTimeout = setTimeout(pruneOldAnalyses, FIRST_RUN_DELAY_MS)
}

/** Stop both timers (shutdown path / tests). No-op when not running. */
export function stopRetentionSweep(): void {
  if (retentionInterval) {
    clearInterval(retentionInterval)
    retentionInterval = null
  }
  if (firstRunTimeout) {
    clearTimeout(firstRunTimeout)
    firstRunTimeout = null
  }
}
