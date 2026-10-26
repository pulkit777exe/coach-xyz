import { Slide } from 'loading-dev'

export default function AnalysisLoading() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 bg-background text-muted-foreground"
      role="status"
      aria-label="Loading analysis"
    >
      <Slide size={48} />
      <p className="text-body leading-5 text-muted-foreground">Loading analysis...</p>
    </div>
  )
}
