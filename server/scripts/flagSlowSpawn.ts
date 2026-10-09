/**
 * Read `probe-boot-cost.json` and annotate the run.
 *
 * This used to be an inline `bun -e '…'` block inside `.github/workflows/ci.yml`. It shipped
 * with an unbalanced backtick — `console.log(\`…` opened a template literal that never closed —
 * so it died with `Unterminated string literal` on EVERY run, and `continue-on-error: true`
 * swallowed it. It had been broken since `ead12ba` and no run ever noticed, because a step that
 * cannot parse reports nothing at all.
 *
 * The generalisable part is the placement: **an inline script in YAML is not linted, not
 * typechecked and not parsed by anything until it runs**, so a syntax error there is invisible
 * to every gate that would have caught it in a `.ts` file. `eslint .` covers `scripts/`; a YAML
 * block scalar is covered by nothing. Hence this file.
 *
 * It only annotates — it never fails the job on a slow number. What it cannot do is report on
 * itself, which is exactly why it used to fail silently.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Phase {
  label: string
  parent: number
  execAndLoader: number | null
  childWork: number | null
  teardown: number | null
  timedOut: boolean
  exitHang: boolean
  neverBooted: boolean
  note: string
}

const SERVER = import.meta.dir
const ROWS = join(SERVER, 'probe-boot-cost.json')

/** Budget a probe spawn is allowed, in ms. Mirrors `PROBE_TIMEOUT_MS` in `tests/spawnProbe.ts`. */
const BUDGET_MS = 10_000

/** A composed-app spawn above this is worth naming, not failing on. */
const SLOW_MS = 1_000

const main = (): number => {
  if (!existsSync(ROWS)) {
    console.log('::error::no probe-boot-cost.json — the measurement step did not run')
    return 1
  }

  let rows: Phase[]
  try {
    const parsed: unknown = JSON.parse(readFileSync(ROWS, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('expected an array')
    rows = parsed as Phase[]
  } catch (err) {
    console.log(`::error::probe-boot-cost.json is unreadable: ${String(err)}`)
    return 1
  }

  const app = rows.find((r) => r.label.includes('composed app'))
  const bare = rows.find((r) => r.label.includes('bare bun'))

  const num = (v: number | null): string => (v === null ? 'n/a' : `${v}ms`)
  console.log(
    `::debug::bare bun ${num(bare?.parent ?? null)} (control) | composed app ${num(app?.parent ?? null)}` +
      ` = exec+load ${num(app?.execAndLoader ?? null)} + graph ${num(app?.childWork ?? null)}` +
      ` + teardown ${num(app?.teardown ?? null)}`,
  )

  if (app?.neverBooted) {
    console.log('::error::composed app NEVER BOOTED — not slowness, a failure to start')
    return 0
  }
  if (app?.exitHang) {
    console.log('::error::composed app finished its work and hung on EXIT — the budget is not boot cost')
    return 0
  }
  if (typeof app?.parent === 'number' && app.parent > SLOW_MS) {
    // A warning, never an error: this number alone does not say whether anything is wrong, and
    // a gate that failed on it would train everyone to ignore it.
    console.log(
      `::warning::composed-app spawn is ${app.parent}ms (budget ${BUDGET_MS}ms). ` +
        'Module graph is the cost if exec+load is small; find the runner facts in this log ' +
        'before assuming the code changed.',
    )
  }
  return 0
}

process.exit(main())
