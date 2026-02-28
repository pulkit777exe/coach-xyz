'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getDownloadUrl } from '@/lib/api'
import type { JobStatus } from '@/types'

interface ResultsSummaryProps {
  status: JobStatus
  jobId: string
  onReset: () => void
}

const SPORT_EMOJI: Record<string, string> = {
  basketball: "🏀",
  football: "⚽",
  cricket: "🏏",
  unknown: "🎯"
}

const capitalize = (str: string) => {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export default function ResultsSummary({ status, jobId, onReset }: ResultsSummaryProps) {
  const summary = status.summary!
  
  return (
    <div className="min-h-screen bg-gray-950 p-6 flex flex-col items-center">
      <div className="max-w-4xl w-full">
        {/* Summary Card */}
        <Card className="mb-6 bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-2xl text-white">
              {SPORT_EMOJI[summary.sport] || SPORT_EMOJI.unknown}{' '}
              {capitalize(summary.sport)} Analysis Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Form Score */}
            <div className="text-center">
              <div className={`text-7xl font-bold ${
                summary.form_score >= 80 ? 'text-green-500' :
                summary.form_score >= 60 ? 'text-yellow-500' : 'text-red-500'
              }`}>
                {summary.form_score}
              </div>
              <p className="text-gray-400 mt-2">
                / 100 · {summary.overall_rating}
              </p>
            </div>

            {/* Summary */}
            <div className="text-center">
              <p className="text-gray-300 italic">{summary.summary}</p>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-800" />

            {/* Top Tips */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">
                Top Coaching Tips
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-gray-300">
                {summary.top_tips.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ol>
            </div>

            {/* Strengths */}
            {summary.strengths.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">
                  Strengths
                </h3>
                <ul className="list-disc list-inside space-y-2 text-gray-300">
                  {summary.strengths.map((strength, index) => (
                    <li key={index}>{strength}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Download Button */}
        <a
          href={getDownloadUrl(jobId)}
          download="coachai_analysis.mp4"
          className="block w-full mb-6"
        >
          <Button className="w-full bg-green-600 hover:bg-green-700 text-white" size="lg">
            ⬇️ Download Analyzed Video
          </Button>
        </a>
        <p className="text-center text-sm text-gray-400 mb-8">
          Video includes pose overlays, form scores, and coaching tips
        </p>

        {/* Shot Events */}
        {summary.shot_events.length > 0 && (
          <div className="mb-8">
            <details className="border border-gray-800 rounded-lg bg-gray-900 p-4">
              <summary className="cursor-pointer text-lg font-semibold text-white">
                Shot Breakdown ({summary.shot_events.length} events)
              </summary>
              <div className="mt-4 space-y-4">
                {summary.shot_events.map((event, index) => (
                  <div key={index} className="border-b border-gray-800 pb-4 last:border-b-0 last:pb-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">
                        {event.event_type}
                      </Badge>
                      <span className="text-sm text-gray-400">
                        @ {event.timestamp}s
                      </span>
                      <span className={`text-sm font-semibold ${
                        event.form_score >= 80 ? 'text-green-500' :
                        event.form_score >= 60 ? 'text-yellow-500' : 'text-red-500'
                      }`}>
                        {event.form_score}/100
                      </span>
                    </div>
                    <p className="text-gray-300">{event.feedback}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* Analyze Another Video Button */}
        <Button
          variant="outline"
          className="w-full border-gray-700 text-white hover:bg-gray-800"
          onClick={onReset}
        >
          Analyze Another Video
        </Button>
      </div>
    </div>
  )
}
