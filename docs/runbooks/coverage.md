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

**Closed since (2026-10-03).** `components/a11y-name-sweep.test.tsx` now renders
**every** component file under `components/` and asserts an accessible name on
every interactive element — 129 tests, taking web-next from 330 to 459. Two
findings came out of it: a genuinely unnamed `sr-only` file input in
`LandingPage.tsx`, and a hole in the sweep itself (a `✕` glyph was being
accepted as a name, so removing the drawer's Close button's `aria-label` went
unnoticed until it was mutation-tested).

### The portal was not the same thing as a DOM

Seven components rendered **zero bytes** because 9ui's `DialogContent` wraps
children in Base UI's `DialogPortal`, which has no server-render output. That was
first recorded here as the honest cost of having no DOM — which was too quick. A
portal needs a *document* to portal into, but nothing about a name check needs the
portal mechanism: mocking `Portal`, `Popup` and `Backdrop` to plain wrappers puts
the content back into the markup.

`keepMounted` was checked first and does **not** help — a plain portal and a
`keepMounted` one both render as nothing, with `aria-expanded` stuck at `false` on
an `open` dialog — so the limit was real. It was just not the limit that mattered.

| component | before | after |
|---|---|---|
| `StudentFormDialog` | 0 b | **17 292 b**, 10 inputs, 14 labels |
| `EventFormDialog` | 0 b | **10 590 b**, 5 inputs, 8 labels |
| `EmailAttendanceDialog` | 0 b | **4 522 b**, 1 input, 3 buttons |
| `InvitePlayersDialog` | 0 b | **3 966 b**, 3 buttons |

Five of the seven are now genuinely swept, including the densest form in the app.
The remaining **2 `PORTAL_ONLY`** entries are named with the reason each still
renders empty — one gated on a linked analysis, one on a mounted-state effect that
`renderToStaticMarkup` never runs. **7 more components are skipped** with a
per-component reason (client-only provider, a store a client effect populates, a
suspend, one non-component).

Reaching the dialogs found a **real defect** the portal had been hiding:
`AttendanceGrid`'s per-student note field was named only by its placeholder, inside
a per-student loop, so a screen reader offered several identical unlabelled boxes
and the coach could not tell whose attendance they were editing.

The fidelity reduction is deliberate and stated: the sweep checks the **content** of
a dialog, not that Base UI mounts it into `document.body`.

### What is still out of reach

- Anything behind an interaction — no effects run and no events dispatch, so a
  `useEffect`-gated panel renders in its initial state. `NotificationBell` is the one
  that shows here.
- Focus management (`focusInitial` / `inertOutside` / `restoreFocusOnClose`) is
  effect-only and is covered against fake nodes by `a11yOverlay.test.ts`.
- Portal wiring itself, per above.
- A name is a name *in context*: name-from-content is accepted, so a combobox whose
  only name is its current value passes. Correct for this assertion, not sufficient
  for the product; `a11ySource.test.ts` holds the stricter greps.

`modal` rendering **0 bytes** is the interesting one, and it is not a testing
gap: the component is `useState`-gated closed, so it is empty in *every* server
render. That is exactly why its accessibility check has to read the source
rather than the output. It is a genuine limitation of `renderToStaticMarkup`,
which runs no effects and dispatches no events.

## What would actually move the web number

Ranked by defect-found-per-hour, not by coverage percentage:

1. ~~**Render the components that already render.**~~ **Done** —
   `components/a11y-name-sweep.test.tsx`, 129 tests, no new dependency.
2. ~~**Supply props/providers**~~ **Done where it was free** — the sweep's
   `withPrefs()` helper already existed and two entries simply were not using it.
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
## web-next: reachability, not coverage

`vitest --coverage` still requires `@vitest/coverage-v8`, which this repo does not carry, so the *reachability* figure below stands as the graph metric. Note what has changed since this section was first written: the tier now has a **DOM** as well (see the next section), because `jsdom` became available once the manifest was released.

```bash
node scripts/webReachability.mjs          # last run saved to docs/web-reachability.txt
```

Current read: **191 source files, 30 test files, 134 statically imported (70.2%)**, 6 loaded only by the generic render sweep, 51 touched by nothing (13.6% of lines).

Two limits decide what that means, and both are printed by the script rather than left for the reader to assume:

1. **Reachability is not execution.** A file can be imported and have none of its branches run. The render sweep proves markup and accessible names; it never proves a value.
2. **The sweep bucket is an upper bound, and measurably so.** `components/a11y-name-sweep.test.tsx` enumerates `components/**` with `readdirSync` and dynamically imports each file, so those components really are rendered — but they leave **no static import edge**, and a naive import-graph metric would report every one of them as untouched. The script therefore reports them separately as *loaded only by a generic sweep*, which is the six components with no test written for them, headed by `StudentsClient.tsx` (973 lines, the largest client component in the app). The separation is keyed on "some test calls `readdirSync`" rather than "this file was enumerated", so mutating the sweep so it walks nothing leaves the numbers unchanged. That is correct for this repo only because the sweep walks from the components directory itself, so enumerating means every component — revisit that line if the sweep's roots ever change.

**The number worth acting on is the 6, not the 51.** Fifty of the untouched files are `app/` route modules, which no unit test can reach and which `next build` already type-checks. Treating them as gaps would be the same mistake as treating Bun's probe-reported sub-50% modules as gaps on the server: a number that points at the wrong files is worse than no number, because it looks like a priority list.

Re-derive and read the LIMITS block at the bottom of the output before quoting any figure from it.

## web-next: a DOM tier, added once the manifest was free

`jsdom` is now a devDependency, so component tests can **run** a component rather than render or grep it. That distinction matters more than the number of tests: `renderToStaticMarkup` never runs `useEffect`, and two components return `null` until an effect resolves state, so they produced **zero output** under every render the sweep performed while being counted as covered.

```bash
# the two DOM files; both opt in per-file so the other 30 files stay on environment: 'node'
bun run test components/org/AnalysisLinkControl.dom.test.tsx
bun run test components/notifications/NotificationBell.dom.test.tsx
```

Two decisions worth knowing before adding a third:

1. **A per-file `// @vitest-environment jsdom` docblock, not a global flip.** Changing `environment` in `vitest.config.mts` would move all 32 files, including the 30 that were written for `node` and never had a DOM. The blast radius of a new environment should be the file that needs it.
2. **`jsdom` alone, not `@testing-library/react`.** React 19 exports `act` from `react` itself, so `createRoot` + `act` + `querySelector` covers what these tests need. One dependency instead of three, and no version coupling to test between React and Testing Library.

**Scope, stated because it is the limit:** the data layer is mocked at the module boundary. That pins the component's behaviour over its inputs, which is the branch that was previously unobservable — it does **not** pin the fetch path (URL construction, JSON handling, error mapping), which the server-side and API tests own. A `jsdom` test with a stubbed fetcher would happily pass while the real request shape was wrong.

### What it found immediately

`NotificationBell`'s dropdown threw on open: `DropdownMenuLabel` wraps Base UI's `Menu.GroupLabel`, which requires a `Menu.Group` ancestor, and the component used it bare. So clicking the bell produced `MenuGroupContext is missing` and the user saw no notifications. `components/org/OrgPill.tsx` — the only other `DropdownMenuLabel` call site — wraps it correctly, which is what identified the component as the outlier rather than the primitive.

This is the strongest available argument for the tier: **a crash on the primary interaction of a shipped component, invisible to every test that existed.**

### The metric that did not move

`scripts/webReachability.mjs` still reports 134 statically imported, 6 sweep-only, 51 untouched — **identical before and after** — because the graph was never wrong. `lib/__tests__/a11ySource.test.ts` → `AnalysisDetailClient` → `AnalysisLinkControl` is a real static edge, so the metric has been calling that component covered for six rounds.

That is not a bug in the metric; it is the limit the script's own LIMITS block states, and it is quoted verbatim in `AGENTS.md`. What the round establishes is that the limit ** bites in practice on the components most likely to matter**, so a reachability percentage should be read as "the import graph reaches this file" and never as "something observed this file". For behaviour, the honest number in this tier is a mutation count — 8 for `AnalysisLinkControl`, 6 for `NotificationBell` — not a coverage percentage.