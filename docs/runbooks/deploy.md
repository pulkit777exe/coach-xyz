# Deploy

## Services

| Service | Platform | Deploys on | Health probe |
|---|---|---|---|
| `web-next` | Vercel | push to main/master (+ deploy hook) | framework default |
| `server` (Bun) | Render | push to main/master (+ deploy hook) | `GET /health` |
| `engine` (FastAPI) | Render/docker-compose | with server | `GET /health` |

Push-to-deploy is automatic on both platforms; `.github/workflows/deploy.yml`
fires the deploy hooks as belt-and-suspenders (both hook secrets optional —
an unset secret skips its hook and the job still succeeds).

## Pre-deploy checklist

- CI green on the branch: typecheck, lint, all tests (incl. the
  TEST_DATABASE_URL-gated suites), `bun audit`, `pip-audit`, Trivy.
- Production env present (Render dashboard): `NODE_ENV=production`,
  `ENGINE_URL`, `UPSTASH_REDIS_REST_URL`/`TOKEN`, `SERVICE_TOKEN`
  (boot refuses without them — see `server/src/lib/env.ts`).
- Web env present (Vercel): `NEXT_PUBLIC_API_URL`, `APP_BASE_URL`,
  `AUTH0_*` (see `docs/AUTH0_TENANT_CHECKLIST.md`).
- Schema changes are additive (`IF NOT EXISTS` in `ensureInitialized`,
  the sole DDL owner) and safe to run ahead of the code.

## Deploy steps

1. Merge to main (or push directly for hotfixes).
2. Watch CI, then the Vercel/Render deployment logs.
3. Verify, in order:
   - `GET <server>/health` → 200 (liveness).
   - `GET <server>/health/deep` → `healthy` (all four checks ok).
   - `GET <server>/health/metrics` → serves (counters start empty).
   - Dashboard loads, one analysis detail renders (auth + DB + engine).
4. Watch Sentry for 15 minutes for `unhandled_error` spikes.

## Rollback

- Vercel: redeploy the previous production deployment (instant).
- Render: roll back to the previous deploy in the dashboard.
- Database: no down-migration exists and none is needed — migrations only
  ever add nullable columns/indexes, so old code runs fine on the new
  schema. If a deploy ever ships a *breaking* DDL change, it must ship
  its rollback migration in the same PR (no such change exists today).
- If the bad deploy already wrote data the old code cannot read, restore
  from backup per `docs/BACKUP_RESTORE.md` before rolling back the code.
