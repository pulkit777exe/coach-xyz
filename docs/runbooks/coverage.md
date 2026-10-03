# Coverage, and why the obvious number is the wrong one

Snapshot: **2026-10-03**. This file's first job is to be **re-derivable**, not to
be right forever — the last dated perf table in this repo went stale silently and
was still being cited a week later. Every number below has the command that
produced it. Re-run them; if a number moved, fix this file in the same commit.

## The three measurements

```bash
# server — must be a LOCAL Postgres, the script refuses otherwise
cd server && TEST_DATABASE_URL=postgres://coachxyz:coachxyz@localhost:55433/coachxyz \
  PERF_DATABASE_URL=$TEST_DATABASE_URL DATABASE_URL= bun scripts/coverage.ts

# engine
cd engine && .venv/bin/python -m pytest tests -q \
  --cov=core --cov=api --cov=sessions --cov-report=json:/tmp/engcov.json

# web — see the caveat, there is no single number
cd web-next && bun run test
```

| tier | lines | how it was obtained |
|---|---|---|
| `server` | **62.8%** in-process | `scripts/coverage.ts` |
| `engine` | **52%** | `pytest-cov`, 41 modules |
| `web-next` | **no meaningful single number** — see below | — |

Source size for scale: `server/src` 111 files / 24k lines, `engine` 49 files /
10.8k lines, `web-next` `components/` 107 files / 21.2k lines + `app/` 51 files /
4.3k lines.

## Two caveats that make the naive numbers actively misleading

Both of these point the work at the **wrong files**, which is worse than being
merely noisy.

### 1. server: Bun only instruments the parent process

This repo runs ~57 authorization probes as **child `bun` processes**, plus a
matrix probe that drives the real composed app across 1452 route × role cases. A
module tested only through a probe reports near-zero in-process while being
heavily tested.

So the raw 62.8% is a **lower bound, and it is least wrong exactly where the
security-critical code lives** — because the security suites are the probe ones.
`src/routes/auth.ts` reports **9.71%** and has held a real §5 medical leak, so it
is the obvious first target; closing "it" would be pure waste, because
`authMatrixProbe` drives it in a child process coverage cannot see.

`scripts/coverage.ts` therefore classifies every sub-50% module by **reachability**
(imported by a probe, or reachable from `src/app.ts`) into *probe-exercised
(artifact)* versus *REAL gap*. Current split of the 36 sub-50% modules: **26
artifacts, 10 real**:

```
chatMessages 7.5%   aiReportData 13.7%   conversation 30.0%
org/schedule 42.3%  org/attendance 42.4% ratelimit 42.9%
users 43.3%         routes/sports 44.9%  org/plans 45.5%   mailer 47.6%
```

### 2. web-next: the include glob was a coverage ceiling

`vitest.config.mts` had `include: ['lib/**/*.test.ts']`. That was not a neutral
default — it made it **impossible to put a test next to the code it covers**.
All 28 test files lived in `lib/__tests__`, while `components/` (21.2k lines) and
`app/` (4.3k lines) had **no test file at all**. A test-location default silently
became a coverage ceiling.

The globs are now `lib|components|app` × `{ts,tsx}`. This costs nothing and needs
no new dependency; `environment` is still `node`.

## The DOM gap is narrower than it looks — measured, not assumed

Three of the 61 accessibility checks are source-level greps because
`environment: 'node'` means no DOM. It is tempting to read that as "component
testing needs jsdom". **It does not.** Probing which components render under
`renderToStaticMarkup` with no DOM and no providers:

```
OK  components/interior/drawer      872b
OK  components/9ui/ui/button        634b
OK  components/9ui/ui/badge         297b
OK  components/9ui/ui/card          212b
OK  components/interior/modal         0b   <-- see below
FAIL components/dashboard/CoachHome      needs props (org stats), not a DOM
FAIL components/org/ScheduleClient      needs PreferencesProvider, not a DOM
```

**5 of 7 render today.** The two failures are missing props and a missing
provider — both solvable without a DOM. So the render-based tier is available
across most of `components/` right now, and the honest gap is much smaller than
"no component tests".

`modal` rendering **0 bytes** is the interesting one, and it is not a testing
gap: the component is `useState`-gated closed, so it is empty in *every* server
render. That is exactly why its accessibility check has to read the source
rather than the output. It is a genuine limitation of `renderToStaticMarkup`,
which runs no effects and dispatches no events.

## What would actually move the web number

Ranked by defect-found-per-hour, not by coverage percentage:

1. **Render the components that already render.** Five do today with zero new
   dependencies. An accessible-name sweep over rendered markup is the same check
   that already found four real accessibility blockers.
2. **Supply props/providers**, which turns most of the remaining `components/`
   into render-testable without a DOM.
3. **A DOM environment (`happy-dom` or `jsdom`)** last. It needs a dependency
   added to `web-next/package.json` + `bun.lock`, and buys effect execution and
   focus management — real, but narrower than items 1 and 2.

## A caveat about the numbers themselves

Coverage measures execution, not correctness. The 19 MB list response, the 43
tests skipping for months, and the engine job that had never once passed were all
*covered* — the tests ran, or would have. What caught them was reading the output
and the logs, not the percentage. **A coverage number is a floor on what could be
wrong, never a ceiling on what is.** `server/tests/payloadBudget.test.ts` is the
model: it asserts bytes, because bytes fail for exactly one reason, whereas
latency on a shared runner is too noisy to gate and a flaky perf gate gets
disabled — which is worse than none.