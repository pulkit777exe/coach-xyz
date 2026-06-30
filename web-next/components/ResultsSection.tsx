'use client';

import { useState } from 'react';
import { getDownloadUrl } from '@/lib/api';

interface ResultsSectionProps {
  data: any;
  jobId: string | null;
  onAnalyzeAgain: () => void;
}

const ResultsSection = ({ data, jobId, onAnalyzeAgain }: ResultsSectionProps) => {
  const [activeTab, setActiveTab] = useState('shots');

  const summary = data.session_summary || {};
  const sport = data.sport || 'Unknown';

  const sportEmoji = {
    basketball: '🏀',
    football: '⚽',
    cricket: '🏏'
  }[sport as keyof { basketball: string; football: string; cricket: string }] || '🎯';

  const ratingClass = `
    ${summary.overall_rating?.toLowerCase().includes('elite') ? 'text-amber-400' : 
      summary.overall_rating?.toLowerCase().includes('advanced') ? 'text-purple-400' :
      summary.overall_rating?.toLowerCase().includes('intermediate') ? 'text-blue-400' :
      'text-gray-400'}`;

  return (
    <section className="py-20 bg-gray-800">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <div className="text-indigo-500 text-sm font-semibold uppercase tracking-wider mb-2">
            Results
          </div>
          <h2 className="text-4xl font-bold">
            {sportEmoji} {sport.charAt(0).toUpperCase() + sport.slice(1)} Session Analysis
          </h2>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="bg-gray-700/50 border border-gray-600 rounded-xl p-6 text-center">
            <div className={`text-4xl font-bold mb-2 ${ratingClass}`}>
              {summary.overall_rating || 'N/A'}
            </div>
            <div className="text-gray-400">Overall Rating</div>
          </div>

          <div className="bg-gray-700/50 border border-gray-600 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-white mb-2">
              {data.shots?.length || 0}
            </div>
            <div className="text-gray-400">Events</div>
          </div>

          <div className="bg-gray-700/50 border border-gray-600 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-green-400 mb-2">
              {summary.success_rate_percent?.toFixed(0) || 0}%
            </div>
            <div className="text-gray-400">Success Rate</div>
          </div>

          <div className="bg-gray-700/50 border border-gray-600 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-yellow-400 mb-2">
              {summary.average_form_score?.toFixed(1) || 0}
            </div>
            <div className="text-gray-400">Avg Form /10</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-4 mb-8">
          <button
            onClick={() => setActiveTab('shots')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'shots' 
                ? 'bg-indigo-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            📋 Shot Breakdown
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'summary' 
                ? 'bg-indigo-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            📊 Session Summary
          </button>

          <button
            onClick={() => setActiveTab('download')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'download' 
                ? 'bg-indigo-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            📥 Download
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-xl p-8">
          {/* Shots Tab */}
          {activeTab === 'shots' && (
            <div>
              <h3 className="text-2xl font-bold mb-6">Shot Breakdown</h3>
              <div className="space-y-6">
                {data.shots?.map((shot: any, index: number) => (
                  <div key={index} className="bg-gray-800/50 border border-gray-600 rounded-lg p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold ${
                          shot.result === 'made' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="text-lg font-semibold">{shot.shot_type || 'Event'}</span>
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                              shot.result === 'made' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {shot.result}
                            </span>
                          </div>
                          <div className="text-gray-400 text-sm mt-1">⏱ {shot.timestamp_of_shot}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${
                          shot.form_score >= 8 ? 'text-green-400' : 
                          shot.form_score >= 5 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {shot.form_score}
                        </div>
                        <div className="text-gray-400 text-sm">Form Score</div>
                      </div>
                    </div>

                    <p className="text-gray-300 mb-4">{shot.feedback}</p>

                    {shot.form_breakdown && (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(shot.form_breakdown).map(([key, value]) => (
                          <span 
                            key={key} 
                            className="px-3 py-1 bg-gray-600 rounded-full text-xs font-medium"
                          >
                            {key.replace('_', ' ')}: {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Tab */}
          {activeTab === 'summary' && (
            <div>
              <h3 className="text-2xl font-bold mb-6">Session Summary</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-6">
                  <h4 className="text-lg font-semibold text-green-400 mb-3">💪 Strengths</h4>
                  <ul className="list-disc list-inside space-y-2 text-gray-300">
                    {summary.strengths?.map((strength: string, index: number) => (
                      <li key={index}>{strength}</li>
                    ))}
                  </ul>
                </div>

                <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-6">
                  <h4 className="text-lg font-semibold text-red-400 mb-3">⚠️ Top Issues</h4>
                  <ul className="list-disc list-inside space-y-2 text-gray-300">
                    {summary.top_issues?.map((issue: string, index: number) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-6">
                <h4 className="text-lg font-semibold text-indigo-400 mb-3">🎯 Next Session Focus</h4>
                <p className="text-gray-300">{summary.priority_drill}</p>
              </div>
            </div>
          )}

          {/* Download Tab */}
          {activeTab === 'download' && (
            <div className="text-center">
              <div className="text-8xl mb-6">🎬</div>
              <h3 className="text-2xl font-bold mb-4">Your Analyzed Video is Ready!</h3>
              <p className="text-gray-400 mb-8">
                The overlay video includes form scores, feedback captions, and a session summary screen.
              </p>

              <div className="flex flex-col md:flex-row gap-4 justify-center">
                <a
                  href={jobId ? getDownloadUrl(jobId) : '#'}
                  download="analyzed.mp4"
                  className="px-8 py-4 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-lg transition-colors"
                >
                  <span>⬇️ Download Video</span>
                </a>

                <button
                  onClick={() => {
                    if (data) {
                      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                      alert('Analysis JSON copied to clipboard!');
                    }
                  }}
                  className="px-8 py-4 border border-gray-600 text-gray-300 hover:bg-gray-700 rounded-lg font-semibold text-lg transition-colors"
                >
                  <span>📋 Copy JSON</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="text-center mt-12">
          <button
            onClick={onAnalyzeAgain}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold text-lg transition-all duration-300"
          >
            <span>Analyze Another Video</span>
          </button>
        </div>
      </div>
    </section>
  );
};

export default ResultsSection;
