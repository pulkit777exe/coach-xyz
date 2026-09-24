import { Slide } from 'loading-dev'

/** Inline loading indicator — the site-wide Slide (inherits text color). */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={`inline-block size-4 ${className}`}>
      <Slide size={16} />
    </span>
  )
}

export default Spinner
