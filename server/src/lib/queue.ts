// ── Queue API (thin preserved surface) ───────────────────────────────────────
// Lifecycle (drain loop, sweeps, shutdown) lives in workerLifecycle.ts. The
// durable queue is Postgres (`server_jobs`); this module re-exports the
// caller-facing API unchanged so enqueue call sites (admission, aiReports) and
// tests need zero edits.
export type { AnalysisPayload, AiReportPayload } from './workerLifecycle'
export {
  JOB_PRIORITY,
  enqueueAnalysis,
  enqueueAiReport,
} from './workerLifecycle'
