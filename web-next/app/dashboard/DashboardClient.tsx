'use client'

import { useState } from 'react'
import Link from "next/link"
import { Tabs, type TabItem } from "@/components/interior/tabs";
import { LiveActivity } from "@/components/interior/live-activity";
import { NewItemsPill } from "@/components/interior/new-items-pill";
import { SnapCarousel } from "@/components/interior/snap-carousel";

const DASHBOARD_TABS: TabItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'recent', label: 'Recent' },
  { value: 'stats', label: 'Stats' },
]

export default function DashboardClient({
  stats,
  analyses,
  error,
  userName,
}: {
  stats: {
    total_analyses: number
    completed_analyses: number
    in_progress_analyses: number
    total_downloads: number
  } | null
  analyses: Array<{
    server_job_id: string
    display_name: string | null
    file_name: string | null
    player_index: number | null
    requested_at: string
    complete: boolean
    error_code: string | null
    summary_json: Record<string, unknown> | null
  }> | null
  error: string | null
  userName: string | null
}) {
  const [activeTab, setActiveTab] = useState('overview')
  const [newItems] = useState(0)


  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-(--cream-40)">
          Dashboard
        </p>
        {newItems > 0 && (
          <NewItemsPill count={newItems} onJump={() => {}} label={(c) => `${c} new analyses`} />
        )}
      </div>
      <h1 className="font-serif text-4xl leading-none text-(--fg) mb-8 sm:text-5xl">
        Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""}
      </h1>

      {/* Tabs */}
      <div className="mb-8">
        <Tabs
          items={DASHBOARD_TABS}
          value={activeTab}
          onValueChange={setActiveTab}
          className="[&_*]:!text-(--fg)"
        />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="border border-(--red) p-4 mb-8">
          <p className="text-sm text-(--red)">Failed to load dashboard data. Please try again later.</p>
        </div>
      )}

      {/* Stats Grid */}
      {stats && (activeTab === 'overview' || activeTab === 'stats') && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-(--cream-05) mb-12">
          {[
            { label: "Total Analyses", value: stats.total_analyses },
            { label: "Completed", value: stats.completed_analyses },
            { label: "In Progress", value: stats.in_progress_analyses },
            { label: "Downloads", value: stats.total_downloads },
          ].map((stat) => (
            <div key={stat.label} className="bg-(--bg) p-6 transition-transform duration-300 hover:scale-[1.02]">
              <p className="font-serif text-3xl text-(--fg)">{stat.value}</p>
              <p className="mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40)">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Live Activity */}
      {activeTab === 'overview' && stats && stats.in_progress_analyses > 0 && (
        <div className="mb-12">
          <LiveActivity
            activity={{
              id: 'current',
              title: 'Analysis in progress',
              detail: `${stats.in_progress_analyses} job${stats.in_progress_analyses > 1 ? 's' : ''} running`,
              phase: 'running',
              progress: null,
            }}
            className="[&_*]:!text-(--fg)"
          />
        </div>
      )}

      {/* Recent Analyses Carousel */}
      {(activeTab === 'overview' || activeTab === 'recent') && analyses && analyses.length > 0 && (
        <div className="mb-8">
          <p className="mb-4 text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
            Recent Activity
          </p>
          <SnapCarousel label="Recent analyses" className="[&_*]:!text-(--fg)">
            {analyses.slice(0, 5).map((a) => (
              <Link
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                className="min-w-[280px] border border-(--cream-10) p-4 transition-all hover:border-(--cream-20) hover:bg-(--cream-03)"
              >
                <p className="text-sm text-(--fg) truncate">
                  {a.display_name || a.file_name || "Untitled"}
                </p>
                <p className="mt-1 text-[0.6rem] text-(--cream-40)">
                  {new Date(a.requested_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                {a.summary_json && typeof a.summary_json === "object" && "form_score" in (a.summary_json as Record<string, unknown>) && (
                  <p className="mt-2 font-serif text-2xl text-(--fg)">
                    {(a.summary_json as Record<string, unknown>).form_score as number}/10
                  </p>
                )}
              </Link>
            ))}
          </SnapCarousel>
        </div>
      )}

          {/* Recent Analyses List */}
      {(activeTab === 'overview' || activeTab === 'recent') && (
        <div className="border border-(--cream-10) p-8">
          <div className="flex items-center justify-between mb-6">
            <p className="text-[0.6rem] uppercase tracking-[0.25em] text-(--cream-40)">
              All Activity
            </p>
            <Link
              href="/dashboard/history"
              className="text-[0.6rem] uppercase tracking-[0.2em] text-(--cream-40) hover:text-(--fg) transition-colors"
            >
              View All
            </Link>
          </div>

          {!analyses || analyses.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-(--cream-40) mb-4">No analyses yet</p>
              <Link
                href="/"
                className="border border-(--cream-10) px-6 py-3 text-[0.65rem] uppercase tracking-[0.2em] text-(--fg) transition-all hover:bg-(--fg) hover:text-(--bg)"
              >
                Start Your First Analysis
              </Link>
            </div>
          ) : (
            <div className="space-y-0">
              {analyses.map((a, i) => (
                <Link
                  key={a.server_job_id}
                  href={`/dashboard/analysis/${a.server_job_id}`}
                  className={`flex items-center justify-between py-4 transition-all duration-300 hover:bg-(--cream-03) -mx-4 px-4 group rounded-sm ${
                    i < analyses.length - 1 ? "border-b border-(--cream-05)" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-(--fg) truncate group-hover:text-(--fg) transition-colors">
                      {a.display_name || a.file_name || "Untitled video"}
                      {a.player_index !== null && ` — Player ${a.player_index}`}
                    </p>
                    <p className="mt-1 text-[0.6rem] text-(--cream-40)">
                      {new Date(a.requested_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    {a.summary_json && typeof a.summary_json === "object" && "form_score" in a.summary_json ? (
                      <span className="font-serif text-lg text-(--fg) transition-transform group-hover:scale-110">
                        {(a.summary_json as { form_score: number }).form_score}
                      </span>
                    ) : null}
                    <span
                      className={`text-[0.6rem] uppercase tracking-[0.15em] px-2 py-1 border transition-all ${
                        a.complete
                          ? "border-(--fg) text-(--fg) bg-(--fg)/10"
                          : a.error_code
                            ? "border-(--red) text-(--red)"
                            : "border-(--cream-20) text-(--cream-20)"
                      }`}
                    >
                      {a.complete ? "Done" : a.error_code ? "Failed" : "Running"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
