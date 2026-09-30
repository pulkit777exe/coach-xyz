// ── In-memory request metrics ───────────────────────────────────────────────
// Per-route counters backing GET /health/metrics. Dependency-free: the key
// is METHOD plus Elysia's route pattern (never a raw id), unmatched paths
// fold to one bucket, averages derive at snapshot time. Process-local.

export const SLOW_REQUEST_MS = 1000

export type RouteStats = {
  count: number
  errors: number
  slow: number
  totalMs: number
}

let table: Record<string, RouteStats> = {}
let startedAt = Date.now()

/** Record one completed request. Only 5xx counts as an error. */
export const recordRequest = (
  method: string,
  route: string | null | undefined,
  status: number,
  durationMs: number,
): void => {
  const k = `${method} ${route ?? 'unmatched'}`
  const stats = table[k] ?? { count: 0, errors: 0, slow: 0, totalMs: 0 }
  stats.count += 1
  if (status >= 500) stats.errors += 1
  if (durationMs > SLOW_REQUEST_MS) stats.slow += 1
  stats.totalMs += durationMs
  table[k] = stats
}

/** JSON shape served by GET /health/metrics. */
export const snapshot = (): {
  uptime_s: number
  routes: Record<string, RouteStats & { avg_ms: number }>
} => {
  const routes: Record<string, RouteStats & { avg_ms: number }> = {}
  for (const [k, stats] of Object.entries(table)) {
    routes[k] = { ...stats, avg_ms: stats.count > 0 ? stats.totalMs / stats.count : 0 }
  }
  return { uptime_s: Math.floor((Date.now() - startedAt) / 1000), routes }
}

/** Test seam: probes assert exact counters from a clean slate. */
export const resetMetricsForTests = (): void => {
  table = {}
  startedAt = Date.now()
}
