// ── Queue API (thin preserved surface) ───────────────────────────────────────
// Lifecycle (connections, workers, QueueEvents, sweeps, shutdown) lives in
// workerLifecycle.ts. This module re-exports the caller-facing API unchanged
// so enqueue call sites (analyze.ts, me.ts, aiReports.ts) need zero edits.
export type { AnalysisPayload, AiReportPayload } from './workerLifecycle'
export {
  JOB_PRIORITY,
  analysisQueue,
  aiReportQueue,
  enqueueAnalysis,
  enqueueAiReport,
  worker,
  aiReportWorker,
} from './workerLifecycle'
