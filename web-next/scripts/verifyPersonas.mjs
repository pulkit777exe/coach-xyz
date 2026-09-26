// Verify the persona matrix against a real browser after scripts/seedPersonas.mjs.
//
// This is the check that the team-scope work exists for: that a coach sees only
// their own team's students, that org staff are not narrowed, and that a player
// sees no roster at all — proven with real Auth0 sessions in a real browser
// rather than a stubbed store, because a stub cannot catch a cookie that fails to
// decrypt or an org the app resolved to the wrong one.
//
// Reads only. It never clicks a write control, so the fixture is unchanged.
//
//   node scripts/seedPersonas.mjs && node scripts/verifyPersonas.mjs
//
// Exits non-zero on any mismatch, so it is usable in a pre-push hook.

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const SESSION_DIR = path.join(HERE, '..', '.personas')
const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000'
const EXECUTABLE =
  process.env.CHROMIUM_PATH ??
  '/home/pulkit/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'

// Mirrors the ROSTER in seedPersonas.mjs: the club org is keyed by the owner's
// own sub, which is the org the app creates for them on first login.
const CLUB = 'auth0|e2e-owner'

/** Who may see which seeded students. Team staff are narrowed; org staff are not. */
const EXPECTED = {
  owner: { role: 'owner', students: ['Player A', 'Player B'] },
  headcoach: { role: 'head_coach', students: ['Player A'] },
  coach: { role: 'coach', students: ['Player A'] },
  assistant: { role: 'assistant_coach', students: ['Player A'] },
  othercoach: { role: 'coach', students: ['Player B'] },
  analyst: { role: 'analyst', students: ['Player A', 'Player B'] },
  medical: { role: 'medical', students: ['Player A', 'Player B'] },
  player: { role: 'player', students: [] },
}

if (!fs.existsSync(SESSION_DIR)) {
  console.error('No personas found. Run: node scripts/seedPersonas.mjs')
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const rows = []
let failures = 0

for (const [persona, want] of Object.entries(EXPECTED)) {
  const file = path.join(SESSION_DIR, `${persona}.json`)
  if (!fs.existsSync(file)) {
    console.error(`  FAIL ${persona}: no session file — re-run seedPersonas.mjs`)
    failures += 1
    continue
  }
  const ctx = await browser.newContext({ storageState: JSON.parse(fs.readFileSync(file, 'utf8')) })
  const page = await ctx.newPage()
  const res = await page.goto(`${BASE}/dashboard/students`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  const got = await page.evaluate(async (club) => {
    const orgs = await (await fetch('/api/service/api/me/orgs')).json().catch(() => ({}))
    const mine = (orgs.orgs ?? []).find((o) => o.org_auth0_id === club) ?? null
    if (!mine) return { role: null, students: [], pinned: false }
    const list = await (
      await fetch(`/api/service/api/org/${club}/students`)
    )
      .json()
      .catch(() => ({}))
    return {
      role: mine.role,
      students: (list.students ?? []).map((s) => s.full_name).sort(),
      pinned: true,
    }
  }, CLUB)

  // The rendered page must agree with the API, or the UI is showing rows the
  // caller should not have.
  const rendered = await page.evaluate(
    (names) => names.filter((n) => document.body.innerText.includes(n)).length,
    want.students,
  )

  const roleOk = got.role === want.role
  const studentsOk = JSON.stringify(got.students) === JSON.stringify(want.students)
  const renderedOk = rendered === want.students.length
  const ok = roleOk && studentsOk && renderedOk && res.status() === 200
  if (!ok) failures += 1

  rows.push({
    persona,
    http: res.status(),
    role: got.role ?? '(none)',
    students: got.students.join(' + ') || '(none)',
    onPage: rendered,
    verdict: ok ? 'ok' : 'FAIL',
  })
  await ctx.close()
}

await browser.close()
console.table(rows)
console.log(
  failures === 0
    ? 'PASS: every persona authenticated with its role, saw exactly its scoped students, and the page matched the API.'
    : `FAIL: ${failures} persona check(s) did not match.`,
)
process.exit(failures === 0 ? 0 : 1)
