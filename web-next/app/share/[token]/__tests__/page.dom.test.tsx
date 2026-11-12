// @vitest-environment jsdom
import { describe, expect, test, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/cache', () => ({ unstable_noStore: () => undefined }))
vi.mock('@/lib/aiReports', () => ({
  resolveShareToken: vi.fn(),
}))

import { resolveShareToken } from '@/lib/aiReports'
import SharePage from '../page'

afterEach(() => {
  vi.clearAllMocks()
})

const baseAnalysis = {
  server_job_id: 'job-1',
  expires_at: '2030-01-01T00:00:00Z',
  analysis: {
    display_name: 'Serve clip',
    requested_at: '2030-01-01T00:00:00Z',
    model: 'gpt-test',
    video_ready: false,
    summary_json: null,
  },
}

const mockResolveShareToken = vi.mocked(resolveShareToken)

describe('Share page presentation honesty', () => {
  test('renders minimal summary with needs-review/quality and no misleading empty states', async () => {
    mockResolveShareToken.mockResolvedValue({
      ...baseAnalysis,
      analysis: {
        ...baseAnalysis.analysis,
        summary_json: {
          form_score: null,
          overall_rating: null,
          confidence: null,
          total_events: 0,
          event_detection: { confirmed: 0, candidate: 2, uncertain: 1 },
          needs_review: true,
          quality: { needs_review: true, issues: ['view_unverified', 'low coverage'] },
          strengths: [],
          top_tips: [],
          shot_events: [],
          summary: '',
        },
      },
    } as unknown as Awaited<ReturnType<typeof resolveShareToken>>)
    const html = renderToStaticMarkup(await SharePage({ params: Promise.resolve({ token: 'tok' }) }))
    expect(html).toContain('Needs review')
    expect(html).toContain('Quality notes: view_unverified; low coverage')
    expect(html).toContain('Confirmed Events')
    expect(html).toContain('2</span> unconfirmed candidates')
    expect(html).toContain('1</span> uncertain')
    expect(html).toContain('not included in confirmed performance counts')
    expect(html).toContain('No key moments were detected in this clip.')
    expect(html).not.toContain('>0%<')
  })

  test('labels unconfirmed candidate events and does not present them as confirmed', async () => {
    mockResolveShareToken.mockResolvedValue({
      ...baseAnalysis,
      analysis: {
        ...baseAnalysis.analysis,
        summary_json: {
          form_score: 7.2,
          confidence: 0.81,
          total_events: 1,
          event_detection: { confirmed: 1, candidate: 1, uncertain: 0 },
          shot_events: [
            { timestamp: 1, event_type: 'serve', event_state: 'candidate', form_score: null, feedback: 'Maybe' },
            { timestamp: 2, event_type: 'rally', event_state: 'confirmed', form_score: 8, feedback: 'Good' },
          ],
        },
      },
    } as unknown as Awaited<ReturnType<typeof resolveShareToken>>)
    const html = renderToStaticMarkup(await SharePage({ params: Promise.resolve({ token: 'tok' }) }))
    expect(html).toContain('Confirmed Events')
    expect(html).toContain('1</span> unconfirmed candidate')
    expect(html).toContain('Unconfirmed candidate')
    expect(html).toContain('Showing 2 of 2 timeline events. Unconfirmed candidates are not confirmed performance.')
  })
})
