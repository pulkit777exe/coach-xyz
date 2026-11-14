# Local CI parity (web-next / server / engine) — prep and interpretation

This runbook documents the **expected** local commands and environment prerequisites to mirror CI, based on repo scripts and `.github/workflows/ci.yml`.

**Parity was not executed as part of this environment's task run** (Node/npm availability and some live-service prerequisites may be absent). Do not claim parity passed unless you actually ran the commands in a suitable environment and observed the results.

## CI sources of truth

- Workflow: `.github/workflows/ci.yml`
- Root orchestration: `package.json`
- App manifests: `web-next/package.json`, `server/package.json`, `engine/requirements.txt`

Always run app commands from the app directory (see `AGENTS.md`: avoid bare `bunx`/`npx` from repo root so local binaries resolve correctly). Verify file writes landed after edits.

## Tool versions (match CI when chasing parity)

| Surface | CI / target | Notes |
| --- | --- | --- |
| web-next | **Node 22.x** (`actions/setup-node@v4`, `node-version: 22`), npm | CI uses `npm ci` and lockfile `web-next/package-lock.json`. |
| server | **Bun** latest via `oven-sh/setup-bun@v2` | CI uses `bun install --frozen-lockfile`. |
| engine | **Python 3.12** (`actions/setup-python@v5`) | Match `engine/Dockerfile` / CI; local 3.11+ may behave differently for version-specific issues. |

In sandboxed environments without Node/npm, `bunx tsc` / `bunx eslint` / `bunx vitest run` / `bunx next build` can be useful smoke checks but are **not** npm/Node CI parity.

## Environment files and variables

Copy the checked-in examples and fill required values; keep secrets local and never commit real values.

| App | Example file | Commonly needed for parity / smoke |
| --- | --- | --- |
| server | `server/.env.example` | `DATABASE_URL` (Neon/Postgres; required for DB-backed flows), `PORT`, `FRONTEND_URL`, `ENGINE_URL`, `SERVICE_TOKEN` (+ `REQUIRE_SERVICE_TOKEN=1` in prod-like runs), `RESEND_API_KEY` / `RESEND_FROM_*` for live email, rate/retention knobs as needed, `SENTRY_DSN` optional. |
| web-next | `web-next/.env.example` | `NEXT_PUBLIC_API_URL`, Auth0 vars (`APP_BASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`), `SERVICE_TOKEN` must match server for identity-proxied org routes, `SERVICE_PROXY_MAX_BODY_BYTES` optional, `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_AUTH_TOKEN` optional. `vitest.config.mts` sets `NEXT_PUBLIC_API_URL=http://localhost:3000` for tests. |
| engine | `engine/.env.example` | `SERVICE_TOKEN` (must match server when enforced), `SERVER_URL`, `GEMINI_API_KEY` optional (analysis can degrade/complete without quota in supported paths), storage/model/runtime knobs (`DATA_DIR`, `STORAGE_BACKEND`, etc.), `SENTRY_DSN` optional. |

For full-stack/manual flows, server, web-next, and engine must agree on URLs/tokens (`NEXT_PUBLIC_API_URL` → server, `ENGINE_URL` → engine, shared `SERVICE_TOKEN`).

## web-next (CI job `web-next`)

**CI:** Ubuntu, Node 22, `npm ci`, `npm audit --audit-level=moderate`, `npx tsc --noEmit`, `npm run lint`, `npm test`, `npx next build`.

**Local parity (from `web-next/`):**

```bash
node -v   # target Node 22.x to match CI
npm ci
npm audit --audit-level=moderate
npx tsc --noEmit
npm run lint
npm test
npx next build
```

**Prereqs/notes:**
- Use lockfile-resolved install (`npm ci`) for parity; `npm install` can drift.
- Some checks/build behavior may depend on env vars present in CI/runtime (e.g. Auth0/Sentry/public config). Compare with `web-next/.env.example` and CI secrets when reproducing CI-only failures.
- `npm test` runs Vitest (`vitest run`) per `web-next/package.json`.

## server (CI job `server`)

**CI:** Bun latest, `bun install --frozen-lockfile`, `bun audit`, `bun run type-check`, `bun run lint`, `bun test`.

**Local parity (from `server/`):**

```bash
bun --version
bun install --frozen-lockfile
bun audit
bun run type-check
bun run lint
bun test
```

**Prereqs/notes:**
- Unit tests expect the configured test environment; live-Neon/integration coverage may require reachable `DATABASE_URL` and related env. Failures from DB connectivity are environmental unless reproduced against the intended database.
- HTTP smoke (`bun run smoke` from `server/`, or `npm run smoke` from root) is **not** part of the default CI job above; it requires `.env`, a running server, and DB/service access.

## engine (CI job `engine`)

**CI:** Python 3.12, `pip install -r requirements.txt` plus `pytest ruff pip-audit`, `pip-audit -r requirements.txt --progress-spinner off`, `ruff check .`, `pytest tests -q`.

**Local parity (from `engine/`):**

```bash
python3 --version   # target 3.12 to match CI/runtime image
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pip install pytest ruff pip-audit
pip-audit -r requirements.txt --progress-spinner off
ruff check .
pytest tests -q
```

**Prereqs/notes:**
- Match CI (3.12) when chasing version-specific issues.
- `/tmp`-based throwaway venvs may be volatile across restarts (see `AGENTS.md`).

## Root aggregate commands

From repo root (Node/npm + Bun required where invoked):

```bash
npm run check      # typecheck + lint + test + format:check
npm run typecheck
npm run lint
npm run test
npm run build      # web-next build
npm run smoke      # server live HTTP smoke (needs .env + running server + DB)
```

Treat these as convenience wrappers; when debugging CI, prefer the per-job commands above.

## Interpreting common environment-only failures

- **DB unreachable / `ERR_POSTGRES_CONNECTION_REFUSED` / Neon connection errors:** server unit/integration or smoke tests cannot reach `DATABASE_URL`; verify credentials/network, that the DB is running/allowed, and rerun. Treat as environmental unless reproducible with a healthy DB.
- **`EMAIL_NOT_CONFIGURED` / 501 from email routes:** expected when `RESEND_API_KEY` is unset; smoke/tests may assert this behavior.
- **Auth/identity proxy failures (403/mismatch) in org routes:** often missing or mismatched `SERVICE_TOKEN` between server and web-next, or missing verified identity headers in direct calls; compare with `server/.env.example`, `web-next/.env.example`, and `web-next/app/api/service/[[...path]]/route.ts`.
- **Auth0 login/callback issues locally:** missing or incorrect `AUTH0_*` / `APP_BASE_URL` / `AUTH0_SECRET`; these do not indicate CI parity for unit jobs but block manual/auth flows.
- **Engine analysis/media failures:** missing `GEMINI_API_KEY`/quota, ffmpeg/MediaPipe/model assets, or storage paths are infra/runtime limits; unit/pytest parity can still be valid if those suites pass.
- **Audit/dependency tool failures:** `npm audit`, `bun audit`, or `pip-audit` reflect dependency/security state, not necessarily application logic regressions; record versions and advisories when reporting.
- **Sandbox/tooling differences:** `bunx`-based checks in a Node/npm-less environment are informative smoke signals, not a substitute for Node 22 + npm CI parity.
