import { describe, expect, test } from 'bun:test'

import {
  analysisResultHref,
  NOTIFICATION_EVENT,
  notifyAiReportFinished,
  notifyAnalysisResult,
  notifyAttendanceRecorded,
  notifyReportReady,
} from '../src/lib/notificationEvents'
import { DEFAULT_EVENTS } from '../src/lib/notificationPrefs'
import type { CreateNotificationInput } from '../src/lib/notifications'

const recorder = () => {
  const sent: CreateNotificationInput[] = []
  return { sent, emit: async (input: CreateNotificationInput) => void sent.push(input) }
}

describe('notification event vocabulary', () => {
  // A name the preferences table does not know is treated as ENABLED, so a
  // drifted or misspelled event silently ignores the user's mute instead of
  // failing. This parity check is what makes that impossible to ship.
  test('every preference has an emitter name and vice versa', () => {
    const prefs: Set<string> = new Set(Object.keys(DEFAULT_EVENTS))
    const emitters: Set<string> = new Set(Object.values(NOTIFICATION_EVENT))
    expect(emitters).toEqual(prefs)
  })

  test('event names are unique', () => {
    const values = Object.values(NOTIFICATION_EVENT)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('emission helpers', () => {
  test('analysis results route to the destination the recipient can open', async () => {
    const { sent, emit } = recorder()
    await notifyAnalysisResult(
      { auth0Id: 'coach-1', event: 'analysisComplete', title: 'Analysis complete' },
      emit,
    )
    expect(sent[0].type).toBe(NOTIFICATION_EVENT.analysisComplete)
    expect(sent[0].auth0Id).toBe('coach-1')

    const failure = recorder()
    await notifyAnalysisResult(
      { auth0Id: 'coach-1', event: 'analysisFailed', title: 'Analysis failed' },
      failure.emit,
    )
    expect(failure.sent[0].type).toBe(NOTIFICATION_EVENT.analysisFailed)
  })

  test('the owner gets the dashboard detail and a requester gets their hub', () => {
    expect(analysisResultHref('coach-1', 'coach-1', 'job-9')).toBe('/dashboard/analysis/job-9')
    expect(analysisResultHref('coach-1', 'player-2', 'job-9')).toBe('/player')
  })

  test('report-ready carries the id and the player route', async () => {
    const { sent, emit } = recorder()
    await notifyReportReady(
      {
        auth0Id: 'player-2',
        title: 'Report ready',
        data: {},
        reportId: 'rep-1',
        href: '/player/reports/rep-1',
      },
      emit,
    )
    expect(sent[0].type).toBe(NOTIFICATION_EVENT.reportReady)
    expect(sent[0].data).toEqual({ report_id: 'rep-1', href: '/player/reports/rep-1' })
  })

  test('attendance and ai-report helpers tag their own events', async () => {
    const a = recorder()
    await notifyAttendanceRecorded({ auth0Id: 'player-2', title: 'Attendance recorded' }, a.emit)
    expect(a.sent[0].type).toBe(NOTIFICATION_EVENT.attendanceRecorded)

    const r = recorder()
    await notifyAiReportFinished({ auth0Id: 'coach-1', title: 'AI report ready' }, r.emit)
    expect(r.sent[0].type).toBe(NOTIFICATION_EVENT.aiReportFinished)
  })
})
