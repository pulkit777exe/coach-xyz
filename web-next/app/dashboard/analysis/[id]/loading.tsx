export default function AnalysisLoading() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center bg-background"
      role="status"
      aria-label="Loading analysis"
    >
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">Loading analysis...</p>
    </div>
  )
}
