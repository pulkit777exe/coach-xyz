#!/usr/bin/env node
/**
 * A real-DOM harness for the two components that no current test can observe.
 *
 * THE GAP THIS CLOSES. `AnalysisLinkControl` returns `null` until its effect has
 * resolved `students`, and `NotificationBell` returns `null` until
 * `inAppEnabled === true`. React never runs `useEffect` in
 * `renderToStaticMarkup`, so the render sweep emits **zero output** for both —
 * it walks them, "covers" them, and observes nothing. `vitest --coverage` would
 * report them as covered too. Reachability is not execution, and here that gap
 * is total rather than partial.
 *
 * WHY A BROWSER RATHER THAN jsdom. The repo has a real Chromium on disk and no
 * installed DOM library, and `web-next/package.json` is owned by another session.
 * A browser plus Node's global `WebSocket` is enough to speak CDP, so this needs
 * no new dependency at all. It is a LOCAL verification harness, not a CI gate:
 * CI has no browser, and pretending otherwise would make it look enforced when it
 * is not. `smokeOrgHttp.ts` and `verifyPersonas.mjs` are the existing precedent
 * for a check that a human runs.
 *
 * FIDELITY. The real component and the real `lib/org` functions are imported and
 * bundled; the data is answered by a fake origin server on the same-origin
 * `/api/service` prefix that `apiFetch` uses in the browser. So the component's
 * fetch, JSON handling, error path and state updates all execute for real.
 *
 * THE TRAP THIS FILE IS BUILT AROUND. Three of the cases assert that the
 * component renders NOTHING. A component that throws during render also renders
 * nothing — so those assertions would pass against a crash, which is precisely
 * the "assertion passing for the wrong reason" failure. Every such case is
 * therefore paired with an assertion that the page raised no error, and a red
 * harness says which of the two happened.
 */
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { launchBrowser, openPage, sleep } from './cdp.mjs'

const PORT = 9411
const BUNDLE = process.env.DOM_HARNESS_BUNDLE ?? '/tmp/opencode/domh/entry.js'

const ORG = 'auth0|org'
const JOB = 'job-1'
const S1 = { id: 's-1', full_name: 'Ada Lovelace', sport: 'soccer', status: 'active' }
const S2 = { id: 's-2', full_name: 'Grace Hopper', sport: 'basketball', status: 'active' }

const PAGE = (scenario) => `<!doctype html>
<html><body>
<div id="root"></div>
<script>window.__SCENARIO__ = ${JSON.stringify(scenario)};</script>
<script type="module" src="/entry.js"></script>
</body></html>`

/**
 * One page per scenario against one server, so a PUT from a previous scenario can
 * never be mistaken for this one's — the recorded-request log is the harness's
 * own evidence, and shared state would make it lie.
 */
const startServer = () => {
  const state = { requests: [] }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/entry.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(readFileSync(BUNDLE))
      return
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const id = url.searchParams.get('id')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE(SCENARIOS[id].scenario))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const current = SCENARIOS[state.current]
      state.requests.push({
        method: req.method,
        path: url.pathname,
        body: body ? JSON.parse(body) : null,
      })
      if (url.pathname.endsWith('/students')) {
        if (current?.failStudents) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'boom' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ students: current?.scenario.students ?? [] }))
        return
      }
      if (url.pathname.endsWith('/student') && req.method === 'PUT') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ analysis: { server_job_id: JOB } }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no' } }))
    })
  })
  return { server, state }
}

// ── assertions ───────────────────────────────────────────────────────────────
let failures = 0
let checks = 0

const check = (name, ok, detail = '') => {
  checks++
  if (!ok) {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`  ✓ ${name}`)
  }
}

/** Read helpers evaluated inside the page. */
const READ = {
  text: `return document.getElementById('root').textContent ?? ''`,
  html: `return document.getElementById('root').innerHTML`,
  errors: `return window.__ERRORS__ ?? []`,
  buttons: `return [...document.querySelectorAll('#root button')].map((b, i) => ({ i, text: (b.textContent ?? '').replace(/\\s+/g, ' ').trim(), disabled: b.disabled }))`,
  clickText: (needle) => `
    const bs = [...document.querySelectorAll('#root button')];
    const b = bs.find((x) => (x.textContent ?? '').includes(${JSON.stringify(needle)}));
    if (!b) return { clicked: false, saw: bs.map((x) => (x.textContent ?? '').trim()) };
    b.click();
    return { clicked: true };
  `,
  clickFirst: `
    const b = document.querySelector('#root button');
    if (!b) return { clicked: false };
    b.click();
    return { clicked: true };
  `,
}

const settle = `await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true`

const waitForRequest = async (page, state, predicate, label) => {
  for (let i = 0; i < 100; i++) {
    if (state.requests.some(predicate)) return true
    await sleep(50)
  }
  throw new Error(`harness timed out waiting for ${label}`)
}

const errorFree = async (page, label) => {
  const errs = await page.evaluate(READ.errors)
  // The other half of every "renders nothing" assertion. Without this a crash
  // would satisfy them.
  check(`${label}: rendered without throwing`, errs.length === 0, errs.join(' | '))
}

// ── scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS = {
  'unlinked-loaded': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: null, students: [S1, S2] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      await errorFree(page, 'unlinked-loaded')
      const text = await page.evaluate(READ.text)
      check('shows the unlinked affordance, not a student name', text.includes('Link to Student'))
      check('no student names leak into the closed trigger', !text.includes(S1.full_name))
      check('the dropdown is closed', !text.includes('Choose a student'))
      const btns = await page.evaluate(READ.buttons)
      check('exactly one control is rendered when closed', btns.length === 1, JSON.stringify(btns))
    },
  },
  'linked-loaded': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: S1.id, students: [S1, S2] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      await errorFree(page, 'linked-loaded')
      const text = await page.evaluate(READ.text)
      check('the trigger shows the linked student', text.includes(S1.full_name))
      check('and not the unlinked label', !text.includes('Link to Student'))
    },
  },
  'empty-roster': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: null, students: [] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      const html = await page.evaluate(READ.html)
      check('an empty roster renders nothing', html === '', html.slice(0, 120))
      await errorFree(page, 'empty-roster')
    },
  },
  'roster-fetch-fails': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: null, students: [S1] },
    failStudents: true,
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students (500)')
      await page.evaluate(settle)
      const html = await page.evaluate(READ.html)
      check('a failed roster fetch renders nothing rather than crashing', html === '', html.slice(0, 120))
      // The load-bearing half of the case above.
      await errorFree(page, 'roster-fetch-fails')
    },
  },
  'dropdown-contents': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: S1.id, students: [S1, S2] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      await page.evaluate(READ.clickFirst)
      await page.evaluate(settle)
      await errorFree(page, 'dropdown-contents')
      const text = await page.evaluate(READ.text)
      check('the dropdown opens', text.includes('Linked to'))
      check('both students are listed', text.includes(S1.full_name) && text.includes(S2.full_name))
      check('the unlink affordance is offered', text.includes(`Unlink ${S1.full_name}`))
      const btns = await page.evaluate(READ.buttons)
      const marks = btns.filter((b) => b.text.includes('· linked'))
      // Selector note: the TRIGGER also renders the linked student's name, so a
      // "find the button containing this name" assertion silently matches the
      // trigger and asserts nothing about the row. Target the row by its
      // `· linked` marker, which only the row carries.
      const linkedRow = marks[0]
      check('the already-linked student is disabled, not clickable', linkedRow?.disabled === true, JSON.stringify(linkedRow))
      check('exactly one row is marked linked', marks.length === 1, JSON.stringify(marks))
      // The inverse, and it is what stops "disable every row" from passing the
      // assertion above: the trigger and the other students must stay usable.
      const trigger = btns[0]
      check('the trigger stays clickable', trigger?.disabled === false, JSON.stringify(trigger))
      const other = btns.find((b) => b.text.includes(S2.full_name))
      check('an unlinked student stays clickable', other?.disabled === false, JSON.stringify(other))
    },
  },
  'choose-student': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: S1.id, students: [S1, S2] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      await page.evaluate(READ.clickFirst)
      await page.evaluate(settle)
      await page.evaluate(READ.clickText(S2.full_name))
      await waitForRequest(page, state, (r) => r.method === 'PUT', 'PUT link')
      await page.evaluate(settle)
      await errorFree(page, 'choose-student')
      const put = state.requests.find((r) => r.method === 'PUT')
      check('the link is persisted with the chosen student', put?.body?.student_id === S2.id, JSON.stringify(put?.body))
      const text = await page.evaluate(READ.text)
      check('the trigger reflects the new link', text.includes(S2.full_name))
      // M5 caught this assertion passing for the WRONG REASON: the panel's header
      // reads 'Choose a student' only while unlinked, so after a successful link
      // it legitimately reads 'Linked to' and the original check passed even with
      // the panel still open. Assert the panel's ABSENCE structurally — control
      // count back to the single trigger — so it cannot be satisfied by a label.
      const after = await page.evaluate(READ.buttons)
      check(
        'the dropdown closed after the write',
        after.length === 1 && !after[0].text.includes(S1.full_name),
        JSON.stringify(after),
      )
    },
  },
  'unlink': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: S1.id, students: [S1, S2] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      await page.evaluate(READ.clickFirst)
      await page.evaluate(settle)
      await page.evaluate(READ.clickText('Unlink '))
      await waitForRequest(page, state, (r) => r.method === 'PUT', 'PUT unlink')
      await page.evaluate(settle)
      const put = state.requests.find((r) => r.method === 'PUT')
      // `null` and `undefined` are different on the wire here: the server keys
      // "unlinked" off an explicit null, and `undefined` would be dropped from
      // the JSON body entirely, leaving the analysis linked with no error.
      check('unlink sends an explicit null, not an absent key', put?.body?.student_id === null, JSON.stringify(put?.body))
      const text = await page.evaluate(READ.text)
      check('the trigger returns to the unlinked label', text.includes('Link to Student'))
    },
  },
  'outside-click-closes': {
    scenario: { auth0Id: ORG, jobId: JOB, initialStudentId: null, students: [S1, S2] },
    async run(page, state) {
      await waitForRequest(page, state, (r) => r.path.endsWith('/students'), 'GET students')
      await page.evaluate(settle)
      await page.evaluate(READ.clickFirst)
      await page.evaluate(settle)
      check('the dropdown is open first', (await page.evaluate(READ.text)).includes('Choose a student'))
      // The real document listener, fired by a real bubbling event on the page —
      // the branch that only exists because of a useEffect, so nothing that
      // renders static markup can observe it.
      await page.evaluate(`
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return true
      `)
      await page.evaluate(settle)
      check('a click outside closes it', !(await page.evaluate(READ.text)).includes('Choose a student'))
    },
  },
}

// ── run ──────────────────────────────────────────────────────────────────────
const profileDir = mkdtempSync(join(tmpdir(), 'domharness-'))
const { server, state } = startServer()
await new Promise((r) => server.listen(0, r))
const httpPort = server.address().port

let browser
try {
  browser = await launchBrowser({ port: PORT, profileDir, log: false })
  console.log(`browser: ${browser.version.Browser}`)
  for (const [name, def] of Object.entries(SCENARIOS)) {
    state.current = name
    state.requests.length = 0
    console.log(`\n${name}`)
    const page = await openPage({ port: PORT, url: 'about:blank' })
    try {
      await page.navigate(`http://127.0.0.1:${httpPort}/?id=${encodeURIComponent(name)}`)
      await def.run(page, state)
    } catch (error) {
      failures++
      checks++
      console.log(`  ✗ harness error — ${error.message}`)
    } finally {
      page.close()
    }
  }
} finally {
  browser?.proc.kill()
  server.close()
  rmSync(profileDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed across ${Object.keys(SCENARIOS).length} scenarios`)
process.exit(failures === 0 ? 0 : 1)