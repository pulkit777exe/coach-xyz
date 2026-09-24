import { Slide } from 'loading-dev'

export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center bg-background text-muted-foreground"
      role="status"
      aria-label="Loading"
    >
      <Slide size={48} />
    </div>
  )
}
