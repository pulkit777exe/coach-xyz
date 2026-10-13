import { describe, expect, it } from 'vitest'

import { partitionAnalyses } from '../useStudentProfileData'
import type { DashboardAnalysis } from '../library'

const analysis = (overrides: Partial<DashboardAnalysis> = {}): DashboardAnalysis =>
  ({
    server_job_id: 'srv-1',
    engine_job_id: 'eng-1',
    session_token: null,
    player_index: null,
    model: 'm',
    stage: 1,
    stage_name: 's',
    progress: 100,
    complete: true,
    video_ready: true,
    summary_json: null,
    error_code: null,
    error_message: null,
    download_count: 0,
    display_name: null,
    file_name: null,
    file_size_bytes: null,
    player_count: null,
    requested_at: '',
    completed_at: null,
    student_id: null,
    ...overrides,
  }) as DashboardAnalysis

describe('partitionAnalyses', () => {
  it('splits linked vs unlinked by student id', () => {
    const rows = [
      analysis({ server_job_id: 'a', student_id: 'stu-1' }),
      analysis({ server_job_id: 'b', student_id: null }),
      analysis({ server_job_id: 'c', student_id: 'stu-2' }),
    ]
    const { linked, unlinked } = partitionAnalyses(rows, 'stu-1')
    expect(linked.map((a) => a.server_job_id)).toEqual(['a'])
    expect(unlinked.map((a) => a.server_job_id)).toEqual(['b'])
  })

  it('returns empty lists for empty input', () => {
    expect(partitionAnalyses([], 'stu-1')).toEqual({ linked: [], unlinked: [] })
  })
})
