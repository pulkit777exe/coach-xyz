export default function DashboardLoading() {
  return (
    <div className="max-w-5xl p-8 lg:p-12" role="status" aria-label="Loading">
      <div className="animate-pulse">
        <div className="mb-4 h-4 w-24 rounded-[6px] bg-muted" />
        <div className="mb-12 h-10 w-64 rounded-[6px] bg-muted" />

        <div className="mb-12 grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card p-6">
              <div className="mb-2 h-8 w-16 rounded-[6px] bg-muted" />
              <div className="h-3 w-20 rounded-[6px] bg-muted" />
            </div>
          ))}
        </div>

        <div className="rounded-[8px] border border-border bg-card p-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="h-3 w-24 rounded-[6px] bg-muted" />
            <div className="h-3 w-16 rounded-[6px] bg-muted" />
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border py-4 last:border-b-0"
              >
                <div className="flex-1">
                  <div className="mb-2 h-4 w-48 rounded-[6px] bg-muted" />
                  <div className="h-3 w-32 rounded-[6px] bg-muted" />
                </div>
                <div className="h-6 w-16 rounded-[6px] bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
