export default function HistoryLoading() {
  return (
    <div className="max-w-5xl p-8 lg:p-12" role="status" aria-label="Loading">
      <div className="animate-pulse">
        <div className="mb-4 h-4 w-16 rounded-[6px] bg-muted" />
        <div className="mb-12 h-10 w-48 rounded-[6px] bg-muted" />

        <div className="divide-y divide-border rounded-[8px] border border-border bg-card">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between p-6">
              <div className="flex-1">
                <div className="mb-2 h-4 w-64 rounded-[6px] bg-muted" />
                <div className="flex items-center gap-4">
                  <div className="h-3 w-24 rounded-[6px] bg-muted" />
                  <div className="h-3 w-16 rounded-[6px] bg-muted" />
                  <div className="h-3 w-12 rounded-[6px] bg-muted" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-8 w-12 rounded-[6px] bg-muted" />
                <div className="h-6 w-16 rounded-[6px] bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
