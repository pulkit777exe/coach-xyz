export default function HistoryLoading() {
  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="animate-pulse">
        <div className="h-4 w-16 bg-(--cream-05) mb-4" />
        <div className="h-10 w-48 bg-(--cream-05) mb-12" />
        
        {/* History List Skeleton */}
        <div className="border border-(--cream-10) divide-y divide-(--cream-05)">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between p-6">
              <div className="flex-1">
                <div className="h-4 w-64 bg-(--cream-05) mb-2" />
                <div className="flex items-center gap-4">
                  <div className="h-3 w-24 bg-(--cream-05)" />
                  <div className="h-3 w-16 bg-(--cream-05)" />
                  <div className="h-3 w-12 bg-(--cream-05)" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-8 w-12 bg-(--cream-05)" />
                <div className="h-6 w-16 bg-(--cream-05)" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
