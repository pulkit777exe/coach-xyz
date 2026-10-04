/**
 * DOM harness entry — rendered in a REAL browser, not a static markup snapshot.
 *
 * Why this file exists at all: both `AnalysisLinkControl` and `NotificationBell`
 * return `null` in every server render (`students === null` / `inAppEnabled !== true`),
 * so `renderToStaticMarkup` — which runs no effects — emits nothing at all for
 * them. The render sweep therefore "covers" two components whose entire visible
 * surface it cannot observe. That is the concrete form of the gap the reachability
 * metric reports as closed.
 *
 * Fidelity choice, and it is deliberate: this imports the REAL component and the
 * REAL `lib/org` data functions rather than stubbing them. The fake origin server
 * in `run.mjs` answers `/api/service/*`, which is exactly the same-origin path
 * `apiFetch` uses in the browser. So the component's fetch, its JSON handling,
 * its error path and its optimistic state update all run for real — a stubbed
 * `orgStudents` would have tested the harness rather than the component.
 *
 * The scenario is injected as JSON into the page so ONE bundle serves every case;
 * rebuilding per scenario would dominate the runtime.
 */
import { createRoot } from 'react-dom/client'

import AnalysisLinkControl from '@/components/org/AnalysisLinkControl'
import type { Student } from '@/lib/org'

type Scenario = {
  auth0Id: string
  jobId: string
  initialStudentId: string | null
  students?: Student[]
}

declare global {
  interface Window {
    __SCENARIO__: Scenario
    __ERRORS__: string[]
  }
}

const scenario: Scenario = window.__SCENARIO__

// Any render throw must reach the harness, or a broken component would read as a
// component that merely renders nothing.
window.__ERRORS__ = []
window.addEventListener('error', (e) => window.__ERRORS__.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) =>
  window.__ERRORS__.push('unhandledrejection: ' + String((e as PromiseRejectionEvent).reason)),
)

const host = document.getElementById('root')!
createRoot(host).render(
  <AnalysisLinkControl
    auth0Id={scenario.auth0Id}
    jobId={scenario.jobId}
    initialStudentId={scenario.initialStudentId}
  />,
)