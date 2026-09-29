// ── In-memory request metrics ───────────────────────────────────────────────
// Per-route counters backing GET /health/metrics. Dependency-free on purpose:
// no collector, no exporter, no cardinality risk — the key is METHOD plus
// Elysia's route pattern (never a raw id), with unmatched paths folded to
// one bucket. Process-local: Render runs one instance; external monitors
// poll the endpoint. A slow-request counter (over SLOW_MS) feeds the SLO
// burn check without storing a histogram.

export const SLOW_REQUEST_MS = 1000

export type RouteStats = {
  count: number
  errors: number
  slow: number
  totalMs: number
}

type MetricsTable = Record<string, RouteStats>

let table: MetricsTable = {}
let startedAt = Date.now()

const key = (method: string, route: string): string => `${method} ${route}`

/** Record one completed request. Route patterns keep cardinality bounded;
 *  anything without a pattern (404s, parse failures) lands in one bucket. */
export const recordRequest = (
  method: string,
  route: string | null | undefined,
  status: number,
  durationMs: number,
): void => {
  const k = key(method, route ?? 'unmatched')
  const stats = table[k] ?? { count: 0, errors: 0, slow: 0, totalMs: 0 }
  stats.count += 1
  if (status >= 500) stats.errors += 1
  if (durationMs > SLOW_REQUEST_MS) stats.slow += 1
  stats.totalMs += durationMs
  table[k] = stats
}

/** JSON shape served by GET /health/metrics. Averages are derived, never
 *  stored, so the table stays four counters per route. */
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
