export default function DashboardLoading() {
  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="animate-pulse">
        <div className="h-4 w-24 bg-(--cream-05) mb-4" />
        <div className="h-10 w-64 bg-(--cream-05) mb-12" />
        
        {/* Stats Grid Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-(--cream-05) mb-12">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-(--bg) p-6">
              <div className="h-8 w-16 bg-(--cream-05) mb-2" />
              <div className="h-3 w-20 bg-(--cream-05)" />
            </div>
          ))}
        </div>
        
        {/* Recent Activity Skeleton */}
        <div className="border border-(--cream-10) p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="h-3 w-24 bg-(--cream-05)" />
            <div className="h-3 w-16 bg-(--cream-05)" />
          </div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-4 border-b border-(--cream-05)">
                <div className="flex-1">
                  <div className="h-4 w-48 bg-(--cream-05) mb-2" />
                  <div className="h-3 w-32 bg-(--cream-05)" />
                </div>
                <div className="h-6 w-16 bg-(--cream-05)" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
