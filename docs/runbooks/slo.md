# SLOs & monitoring

Probes (all guard-exempt, no credentials needed):

| Endpoint | Purpose | Polled by |
|---|---|---|
| `GET /health` | Liveness, fast 200 | Render health check, Docker HEALTHCHECK |
| `GET /health/deep` | Readiness: redis / database / engine / queue depth | External monitor (UptimeRobot/Better Uptime), on-call triage |
| `GET /health/metrics` | Per-route counters (`count`, `errors`, `slow`, `avg_ms`) | Burn-rate checks, weekly review |

Trace correlation: every response echoes `x-request-id` (client-supplied or
generated); engine calls forward it; `unhandled_error` log lines (and their
Sentry events) carry `request_id`. Join access log → error → engine trace
on that id.

## Objectives (30-day window)

- **Availability 99.5%**: shallow `/health` returns 200. Budget: ~3.6h/month.
- **Read latency**: p95 < 500ms on roster/history/findings reads at current
  scale (see `perf-baseline.md`; re-baseline past 10× data).
- **Error rate < 0.5%**: 5xx share from `/health/metrics`
  (`errors / count` summed over routes, excluding the `unmatched` bucket).
- **Degraded, not down**: engine or database loss surfaces as `degraded`
  on `/health/deep` while shallow stays 200 — the app must never 500 its
  liveness probe over a downstream outage.

## Alert thresholds

- `/health/deep` → `unhealthy` (Redis down, HTTP 503): page immediately.
  Without Redis there is no queue, no sessions, no share tokens.
- `degraded` > 10 minutes: investigate (engine or database).
- `queue.failed > 10`: investigate worker errors (see queue logs).
- Rising `slow` share or `avg_ms` on a hot route: compare against
  `perf-baseline.md`; check for a flipped query plan first.

## Triage by failing check

- **redis**: verify Upstash status/quota (`max requests limit exceeded` is
  fatal — workers stop, see `lib/queue.ts`). Failover is local Redis via
  compose for dev; production waits on the provider.
- **database**: verify Neon status; the app fail-opens to no-history mode
  by design, so confirm whether the outage is full or partial before
  restarting (a restart during a Neon blip just replays init).
- **engine**: verify the engine service; client-facing analysis/scan/chat
  return shaped `ENGINE_UNAVAILABLE` (retryable) while everything else
  keeps serving.
- **queue.backlog rising, workers alive**: check engine latency first —
  a slow engine backs up the queue without a single error.

## Cadence

- Weekly: pull `/health/metrics`, compare error share and slow share
  against the objectives above; file an issue on any breach.
- Monthly: error-budget review — if availability burned > 50% of budget,
  freeze non-urgent deploys until the cause ships a fix.
- After any incident: append date/duration/cause to the restore drill log
  in `BACKUP_RESTORE.md` and link it here.
