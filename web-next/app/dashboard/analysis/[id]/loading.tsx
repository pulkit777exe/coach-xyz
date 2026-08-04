export default function AnalysisLoading() {
  return (
    <div className="min-h-screen bg-(--bg) flex flex-col items-center justify-center">
      <div className="w-12 h-12 border-4 border-(--cream-10) border-t-(--fg) rounded-full animate-spin mb-4" />
      <p className="text-(--cream-40) text-sm">Loading analysis...</p>
    </div>
  )
}
