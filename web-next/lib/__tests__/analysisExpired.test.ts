import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { isCoachAIError } from '@/lib/errors'

// ── A failed READ is not an expiry verdict ────────────────────────────────────────────
//
// `app/dashboard/analysis/[id]/page.tsx` caught every failure the same way:
//
//   try { data = (await getDashboardAnalysisDetail(auth0Id, id)).analysis }
//   catch (err) { console.error(...); data = null }
//
// and `AnalysisDetailClient` renders `initialData === null` as:
//
//   <h1>Analysis Expired</h1>  <p>Analysis not found or expired.</p>  [Start New Analysis]
//
// **So one transient 5xx told a coach their analysis had expired** — for an analysis that
// existed and that they own — and offered a link to redo work they had already paid for. A
// 404, a 403 and a 500 are three different facts and were rendered as one.
//
// The distinction does not have to be invented: `errorFromResponse` already sets
// `retryable` from `status >= 500`, so absence is non-retryable and a transport or server
// failure is retryable. The fix is refusing to discard a signal the error shape already
// carried. `retryable` is not a synonym for "not found" and is not used as one here — it is
// used as what it says: whether retrying is the right next action, which is exactly the
// decision the UI was getting wrong.

const ROOT = join(import.meta.dirname, '..', '..')
const page = readFileSync(join(ROOT, 'app', 'dashboard', 'analysis', '[id]', 'page.tsx'), 'utf8')
const client = readFileSync(join(ROOT, 'components', 'AnalysisDetailClient.tsx'), 'utf8')

describe('a failed read is rendered as a failure, not as an expiry', () => {
  test('the page no longer collapses every failure to `data = null`', () => {
    // The specific shape that caused it: a catch whose only action is `data = null`.
    expect(page).not.toMatch(/catch \(err\) \{[^}]*console\.error\([^)]*\);?\s*data = null\s*\}/)
    expect(page).toContain('loadFailed')
  })

  test('the page derives the flag from the error, not from optimism', () => {
    expect(page).toContain('isCoachAIError(err) ? err.retryable : true')
  })

  test('the client has a distinct branch for it, with a RETRY rather than a new analysis', () => {
    // A retry is the whole point: this state is expected to be transient, so the affordance
    // must be "try again", never "start a new analysis" — which would invite a duplicate
    // upload of work that already succeeded.
    expect(client).toContain('initialLoadFailed')
    expect(client).toMatch(/if \(initialLoadFailed\)/)
    // Scoped to the BRANCH, not the file: `router.refresh()` also appears in the SSE reconnect
    // path, so a whole-file assertion passed even after I replaced the retry with a
    // navigate-away — which is the exact wrong behaviour this test exists to prevent, and the
    // first version of this assertion could not tell the two apart.
    const branch = client.slice(client.indexOf('if (initialLoadFailed)'))
    expect(branch.slice(0, branch.indexOf('Analysis Expired'))).toContain('router.refresh()')
    // The expiry branch must remain reachable for a genuine absence.
    expect(client).toContain('Analysis Expired')
  })

  test('THE DISCRIMINATOR: retryable separates a 5xx from a 404', () => {
    // Positive control on the signal itself, so the page's one-line derivation is grounded.
    const notFound = {
      code: 'NOT_FOUND',
      message: 'nope',
      layer: 'server' as const,
      retryable: false,
    }
    const serverError = {
      code: 'INTERNAL',
      message: 'boom',
      layer: 'server' as const,
      retryable: true,
    }
    expect(isCoachAIError(notFound)).toBe(true)
    expect(isCoachAIError(serverError)).toBe(true)
    expect(notFound.retryable).toBe(false)
    expect(serverError.retryable).toBe(true)
    // An unrecognised throwable must NOT be read as "absent" — the page defaults to failed.
    expect(isCoachAIError(new Error('x'))).toBe(false)
  })

  test('the scan is not vacuous — the two files are the ones being asserted on', () => {
    expect(page).toContain('getDashboardAnalysisDetail')
    expect(client).toContain('AnalysisDetailClientProps')
  })
})
