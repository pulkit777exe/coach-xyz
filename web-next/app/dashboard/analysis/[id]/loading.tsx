export default function AnalysisLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-background">
      <div className="mb-4 size-12 animate-spin rounded-full border-4 border-muted border-t-primary" />
      <p className="text-sm text-muted-foreground">Loading analysis...</p>
    </div>
  )
}
