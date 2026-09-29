# Incident response

## Severity

- **S1 — down**: shallow `/health` non-200, or `/health/deep` `unhealthy`
  (Redis). Page immediately; all hands until shallow is 200.
- **S2 — degraded**: `/health/deep` `degraded` > 10 min, error budget
  burning (see `slo.md`), queue backlog growing. Investigate within the
  hour; announce in-channel.
- **S3 — scoped**: one feature erroring (e.g. engine 5xx on analysis
  while everything else serves). Normal ticket priority; link the
  `request_id`s.

## Triage (first 5 minutes)

1. `GET /health/deep` — which check is red? Follow the per-check section
   in `slo.md` (redis / database / engine / queue).
2. `GET /health/metrics` — which routes error, since when (`avg_ms`,
   `errors` climbing on one route = deploy-related; all routes at once
   = downstream).
3. Sentry: latest `unhandled_error` events, joined by `request_id` to the
   access log and engine trace.
4. `git log --oneline -5` on main: did a deploy precede the onset? If yes,
   roll back per `deploy.md` first, diagnose second.

## Comms

- S1: announce start/updates/resolution in-channel with timestamps.
- Anything user-visible > 30 min: status note to coaches (template in
  the org's comms channel — keep it to what broke, who is affected,
  and the next update time).

## Postmortem (within 48h, blameless)

1. Timeline (detection → triage → mitigation → resolution).
2. Root cause (five whys, one paragraph).
3. What detected it — and what should have (new alert? new matrix row?
   new kill-test? file the follow-up as an issue, not a TODO).
4. Action items with owners and dates.
5. Link: append the entry to the drill log in `docs/BACKUP_RESTORE.md`
   when data was restored, and reference this phase's runbook set.

## Runbook index

- `slo.md` — objectives, thresholds, per-check triage, cadence.
- `deploy.md` — services, checklist, verify steps, rollback.
- `perf-baseline.md` — latency baselines + query plans (is it slower
  than baseline, or is baseline stale?).
- `../BACKUP_RESTORE.md` — what is backed up, restore procedure, drill log.
