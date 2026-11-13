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

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = async (opts?: { shareToken?: { url: string; expires_at: string } }) => {
  const createShareToken = vi.fn(async () => opts?.shareToken ?? { url: '/share/abc', expires_at: '2026-12-01T00:00:00Z' })
  vi.doMock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
  vi.doMock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
  vi.doMock('next/dynamic', () => ({ default: () => () => null }))
  vi.doMock('loading-dev', () => ({ Slide: () => <span>loading</span> }))
  vi.doMock('@/components/AnalysisTitle', () => ({ default: () => <div>Title</div> }))
  vi.doMock('@/components/TimestampPill', () => ({ default: ({ seconds }: any) => <span>{seconds}s</span> }))
  vi.doMock('@/components/AnalysisProgress', () => ({ default: () => <div>progress</div> }))
  vi.doMock('@/components/ErrorScreen', () => ({ default: () => <div>error</div> }))
  vi.doMock('@/components/analysis/ProStatsPanel', () => ({ default: () => <div>prostats</div> }))
  vi.doMock('@/components/FindingsTimeline', () => ({ default: ({ findings }: any) => <div>findings:{findings?.length ?? 0}</div> }))
  vi.doMock('@/components/HistoryChat', () => ({ default: () => <div>chat</div> }))
  vi.doMock('@/components/VideoPlayer', () => ({ VideoPlayer: () => <div>player</div> }))
  vi.doMock('@/lib/scan', () => ({
    getJobStatus: vi.fn(async () => ({ complete: true, video_ready: false, summary: {} })),
    getAuthorizedDownloadUrl: vi.fn(async () => '/dl'),
    getDownloadUrl: () => '/dl',
  }))
  vi.doMock('@/lib/aiReports', () => ({ createShareToken }))
  vi.doMock('@/lib/analysisEvents', () => ({
    startAnalysisStatus: (opts: any) => {
      const s = { complete: true, video_ready: false, summary: null }
      opts.onStatus?.(s)
      opts.onComplete?.(s)
      return { stop: () => {}, refresh: () => {} }
    },
  }))
  vi.doMock('@/lib/library', () => ({ cancelAnalysis: vi.fn(), deleteAnalysis: vi.fn() }))
  vi.doMock('@/components/org/AnalysisLinkControl', () => ({ default: () => <div>link</div> }))
  vi.doMock('@/components/org/StatusPill', () => ({ default: ({ children }: any) => <span>{children}</span> }))
  vi.doMock('@/components/9ui/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
  vi.doMock('@/components/interior/copy-button', () => ({ CopyButton: ({ label }: any) => <button>{label}</button> }))
  vi.doMock('@/components/interior/hold-to-confirm', () => ({ HoldToConfirm: ({ children }: any) => <div>{children}</div> }))
  vi.doMock('@/components/interior/modal', () => ({ Modal: ({ open, title, onClose, children }: any) => open ? <div role="dialog" aria-label={title}><button type="button" onClick={onClose}>Close dialog</button>{children}</div> : null }))
  vi.doMock('@/components/interior/drawer', () => ({ Drawer: ({ open, children }: any) => open ? <div>{children}</div> : null }))
  vi.doMock('@/components/interior/loading-button', () => ({ LoadingButton: ({ children, onAction }: any) => <button onClick={onAction}>{children}</button> }))
  vi.doMock('@/lib/date', () => ({ formatDateTime: (v: string) => v }))
  const mod = await import('@/components/AnalysisDetailClient')
  return { Detail: mod.default, createShareToken }
}

const baseData = {
  server_job_id: 's1',
  engine_job_id: 'e1',
  display_name: 'Test',
  file_name: 'f',
  requested_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  model: 'm',
  player_count: 1,
  complete: true,
  error_code: null,
  error_message: null,
  video_ready: false,
  download_count: 0,
  session_token: null,
  student_id: null,
  summary_json: null,
} as any
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('AnalysisDetailClient presentation honesty', () => {
  test('renders empty states, needs review/quality, and confirmed vs candidate distinctions', async () => {
    const { Detail } = await load()
    const data = {
      ...baseData,
      summary_json: {
        summary: '',
        needs_review: true,
        quality: { needs_review: true, issues: ['view_unverified'] },
        form_score: null,
        confidence: null,
        average_score: null,
        success_rate: null,
        total_events: 1,
        event_detection: { confirmed: 1, candidate: 1, uncertain: 0 },
        findings: [],
        shot_events: [
          { timestamp: 1, event_type: 'serve', event_state: 'candidate', form_score: null, feedback: '' },
          { timestamp: 2, event_type: 'rally', event_state: 'confirmed', form_score: 8, feedback: 'ok' },
        ],
        session_metrics: [],
        strengths: [],
        top_tips: [],
        priority_drill: null,
      },
    }
    await act(async () => { root.render(<Detail auth0Id="u" jobId="s1" initialData={data} />) })
    const text = container.textContent || ''
    expect(text).toContain('Needs review')
    expect(text).toContain('Quality notes: view_unverified')
    expect(text).toContain('No session summary was produced for this analysis.')
    expect(text).toContain('Annotated video is not available for this analysis.')
    expect(text).toContain('No evidence findings were produced for this analysis.')
    expect(text).toContain('1 confirmed events')
    expect(text).toContain('1 unconfirmed candidate')
    expect(text).toContain('Unconfirmed candidate')
    expect(text).toContain('No measured metrics or professional stats are available for this analysis.')
    expect(text).toContain('No strengths were identified for this analysis.')
    expect(text).toContain('No specific focus areas were produced.')
    expect(text).toContain('No drill recommendation available.')
    expect(text).not.toContain('Criteria registry')
  })

  test('renders criteria registry section and summary count when provided', async () => {
    const { Detail } = await load()
    const data = {
      ...baseData,
      summary_json: {
        criteria_registry: [
          {
            criterion_id: 'c1',
            label: 'Hip extension',
            evidence_type: 'kinematic',
            validation_status: 'experimental',
            implementation: 'engine_v1',
            allowed_views: ['side'],
            paper_definition: 'Angle at peak extension.',
          },
        ],
        summary: 'ok',
      },
    }
    await act(async () => { root.render(<Detail auth0Id="u" jobId="s1" initialData={data} />) })
    const text = container.textContent || ''
    expect(text).toContain('Criteria registry')
    expect(text).toContain('1 entry')
    expect(text).toContain('Hip extension')
    expect(text).toContain('ID c1')
    expect(text).toContain('evidence kinematic')
    expect(text).toContain('validation experimental')
  })
})

  test('share dialog exposes a labelled, keyboard-focusable link field and closes', async () => {
    const { Detail } = await load({ shareToken: { url: '/share/abc', expires_at: '2026-12-01T00:00:00Z' } })
    await act(async () => { root.render(<Detail auth0Id="u" jobId="s1" initialData={baseData} />) })

    const shareBtn = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Share')
    expect(shareBtn).toBeTruthy()
    await act(async () => { shareBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // allow createShareToken promise/effects to settle
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })

    const input = document.body.querySelector('#analysis-share-url') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.getAttribute('readonly')).not.toBeNull()
    const label = document.body.querySelector('label[for="analysis-share-url"]')
    expect(label?.textContent).toContain('Share link')
    expect(document.body.textContent).toContain('Expires 2026-12-01T00:00:00Z')

    const close = [...document.body.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Close dialog'))
    expect(close).toBeTruthy()
    await act(async () => { close!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
