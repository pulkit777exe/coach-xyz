export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground ${className}`}
    />
  )
}

export default Spinner
