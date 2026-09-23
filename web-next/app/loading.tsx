export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center bg-background"
      role="status"
      aria-label="Loading"
    >
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground" />
    </div>
  )
}
