// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let container: HTMLDivElement
let root: Root

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.resetModules()
})

const load = async () => {
  vi.doMock('gsap', () => ({ default: { from: () => undefined, registerPlugin: () => undefined } }))
  vi.doMock('@gsap/react', () => ({ useGSAP: (fn: () => void) => fn() }))
  vi.doMock('motion/react', () => ({ useReducedMotion: () => true }))
  vi.doMock('@/lib/useAuthorizedMediaUrl', () => ({ useAuthorizedMediaUrl: () => '' }))
  vi.doMock('@/lib/scan', () => ({
    getAuthorizedDownloadUrl: async () => '/signed/video.mp4',
    getDownloadUrl: (id: string) => `/api/download/${id}`,
  }))
  const mod = await import('@/components/ResultsSummary')
  return mod.default
}

describe('ResultsSummary presentation honesty', () => {
  test('minimal summary shows empty states, needs review/quality, and no misleading zeros', async () => {
    const Summary = await load()
    const status = {
      video_ready: false,
      summary: {
        sport: 'cricket',
        form_score: null,
        overall_rating: null,
        confidence: null,
        average_score: null,
        success_rate: null,
        summary: '',
        strengths: [],
        top_tips: [],
        shot_events: [],
        findings: [],
        session_metrics: [],
        needs_review: true,
        quality: { needs_review: true, issues: ['view_unverified'] },
        event_detection: { confirmed: 0, candidate: 2, uncertain: 1, rejected: 0, candidate_count: 3, method: 'x', validation_status: 'x', note: '' },
      },
    } as unknown as Parameters<typeof Summary>[0]['status']
    await act(async () => {
      root.render(<Summary status={status} jobId="j1" onReset={() => {}} />)
    })
    const text = container.textContent || ''
    expect(text).toContain('Needs review')
    expect(text).toContain('Quality notes: view_unverified')
    expect(text).toContain('Not enough measured evidence to highlight strengths yet.')
    expect(text).toContain('No specific focus areas were produced for this clip.')
    expect(text).toContain('0 confirmed events')
    expect(text).toContain('2 unconfirmed candidates')
    expect(text).toContain('1 uncertain')
    expect(text).toContain('Annotated video is not available for this run.')
    expect(text).not.toContain('0%')
  })

  test('labels confirmed vs unconfirmed candidate events in timeline', async () => {
    const Summary = await load()
    const status = {
      video_ready: false,
      summary: {
        sport: 'cricket',
        form_score: 7,
        overall_rating: 'good',
        summary: 'ok',
        strengths: ['s'],
        top_tips: ['t'],
        findings: [],
        event_detection: { confirmed: 1, candidate: 1, uncertain: 0, rejected: 0, candidate_count: 2, method: 'x', validation_status: 'x', note: '' },
        shot_events: [
          { timestamp: 1, event_type: 'drive', event_state: 'candidate', form_score: null, feedback: 'maybe' },
          { timestamp: 2, event_type: 'drive', event_state: 'confirmed', form_score: 8, feedback: 'good' },
        ],
      },
    } as unknown as Parameters<typeof Summary>[0]['status']
    await act(async () => {
      root.render(<Summary status={status} jobId="j1" onReset={() => {}} />)
    })
    const text = container.textContent || ''
    expect(text).toContain('1 confirmed events')
    expect(text).toContain('1 unconfirmed candidate')
    expect(text).toContain('2 timeline events')
    expect(text).toContain('1 confirmed events')
    expect(text).toContain('Unconfirmed candidate')
  })
})
