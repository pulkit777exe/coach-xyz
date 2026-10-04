/**
 * A minimal Chrome DevTools Protocol client. No dependencies.
 *
 * This exists because the repo has a real Chromium on disk (the browser
 * `scripts/verifyPersonas.mjs` already expects under
 * `~/.cache/ms-playwright/chromium-<build>/chrome-linux64/chrome`) but no
 * installed `playwright` or `playwright-core` — so that script cannot currently
 * run. Node 24 ships a global `WebSocket`, which is the only thing a CDP client
 * actually needs, so the browser becomes reachable without touching
 * `package.json`.
 *
 * Deliberately not a browser-automation library: it does navigate, evaluate and
 * nothing else. Every capability it lacks is one that would need review.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** The Chromium `verifyPersonas.mjs` hardcodes, with a scan as the fallback. */
export const findChromium = () => {
  const pinned = join(
    homedir(),
    '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  )
  if (existsSync(pinned)) return pinned
  const cache = join(homedir(), '.cache/ms-playwright')
  if (!existsSync(cache)) return null
  for (const dir of readdirSync(cache)) {
    for (const rel of [
      ['chrome-linux64', 'chrome'],
      ['chrome-linux', 'chrome'],
    ]) {
      const candidate = join(cache, dir, ...rel)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const launchBrowser = async ({ port, profileDir, log }) => {
  const binary = findChromium()
  if (!binary) throw new Error('no Chromium found under ~/.cache/ms-playwright')
  const proc = spawn(
    binary,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', log ? 'inherit' : 'ignore'] },
  )
  // Wait for the debugging endpoint rather than sleeping a guessed interval:
  // a fixed sleep is either slow or flaky, and both look like a harness bug.
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return { proc, binary, version: await res.json() }
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  proc.kill()
  throw new Error(`Chromium did not expose a debugging port on ${port}`)
}

class Connection {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else resolve(msg.result)
        return
      }
      if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // A command that never answers would hang the harness with no diagnostic,
      // so every wait is bounded and the bound is named in the error.
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`CDP ${method} timed out after 10s`))
        }
      }, 10_000)
    })
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }

  once(method) {
    return new Promise((resolve) => {
      const fn = (params) => resolve(params)
      this.on(method, fn)
    })
  }
}

/**
 * A page target, obtained through `/json/new` so no Target-domain session
 * multiplexing is needed — the page's own WebSocket speaks CDP directly.
 */
export const openPage = async ({ port, url }) => {
  // Chrome ≥ 111 requires PUT for /json/new.
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(`/json/new failed: ${res.status}`)
  const target = await res.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP socket error')), { once: true })
  })
  const conn = new Connection(ws)
  await conn.send('Page.enable')
  await conn.send('Runtime.enable')
  return {
    conn,
    /** Evaluate an expression in the page and return its JSON value. */
    async evaluate(expression) {
      const out = await conn.send('Runtime.evaluate', {
        // Async IIFE, paired with awaitPromise: several of the reads have to wait
        // for React to commit and for two animation frames, which needs `await`.
        expression: `(async () => { ${expression} })()`,
        returnByValue: true,
        awaitPromise: true,
      })
      if (out.exceptionDetails) {
        const d = out.exceptionDetails
        throw new Error(
          `page threw: ${d.exception?.description ?? d.text}`.split('\n')[0],
        )
      }
      return out.result.value
    },
    async navigate(next) {
      const loaded = conn.once('Page.loadEventFired')
      await conn.send('Page.navigate', { url: next })
      await loaded
    },
    close: () => ws.close(),
  }
}

export { sleep }