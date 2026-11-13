# Local CI parity (web/server/engine) — prep notes

This documents the **expected** local commands and environment prerequisites to mirror CI, based on repo scripts and `.github/workflows/ci.yml`. **Parity was not executed in this environment** as part of the current task (Node/npm availability and some live-service prerequisites may be absent).

## CI sources of truth

- Workflow: `.github/workflows/ci.yml`
- Root orchestration: `package.json`
- App manifests: `web-next/package.json`, `server/package.json`, `engine/requirements.txt`

Always run app commands from the app directory (see `AGENTS.md`: avoid bare `bunx`/`npx` from repo root so local binaries resolve correctly).

## web-next (Next.js, CI job `web-next`)

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
- Use the lockfile-resolved install (`npm ci`) for parity; `npm install` can drift.
- `vitest.config.mts` sets `NEXT_PUBLIC_API_URL=http://localhost:3000` for tests.
- Some checks/build behavior may depend on env vars present in CI/runtime (e.g. Sentry/Auth0/public API config); compare with `web-next/.env.example` and CI secrets if reproducing a CI-only failure.
- In sandboxed environments without Node/npm, `bunx tsc` / `bunx eslint` / `bunx vitest` / `bunx next build` can be useful smoke checks but are **not** npm/Node CI parity.

## server (Bun, CI job `server`)

**CI:** Bun latest via `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`, `bun audit`, `bun run type-check`, `bun run lint`, `bun test`.

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
- Unit tests expect the configured test environment; live-Neon integration coverage may require reachable `DATABASE_URL` and related env (`server/.env.example`). Failures from DB connectivity are environmental unless reproduced against the intended database.
- HTTP smoke (`npm run smoke` from root, or `cd server && bun run smoke`) requires `.env`, a running server, and DB access; not part of the default CI job shown above.

## engine (Python, CI job `engine`)

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
- Local baseline in this repo may be 3.11+; match CI (3.12) when chasing version-specific issues.
- `/tmp`-based throwaway venvs may be volatile across restarts (see `AGENTS.md`).

## Root aggregate commands

From repo root (Node/npm + Bun required where invoked): `npm run check`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run smoke`. Treat these as convenience wrappers; when debugging CI, prefer the per-job commands above.
