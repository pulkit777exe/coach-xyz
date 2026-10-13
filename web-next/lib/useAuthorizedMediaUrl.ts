// ── Authorized media URL ─────────────────────────────────────────────────────
// One home for the resolved-download-URL chain triplicated across the
// analysis views: synchronous base URL first (so first paint never waits),
// then the signed attribution-token URL when mintable. Owned jobs need the
// token in the query string because <video>/<a> cannot send headers.

import { useEffect, useState } from 'react'

import { getAuthorizedDownloadUrl, getDownloadUrl } from './scan'

export function useAuthorizedMediaUrl(jobId: string): string {
  const [url, setUrl] = useState(() => getDownloadUrl(jobId))
  const [urlJob, setUrlJob] = useState(jobId)
  if (urlJob !== jobId) {
    setUrlJob(jobId)
    setUrl(getDownloadUrl(jobId))
  }
  useEffect(() => {
    let cancelled = false
    void getAuthorizedDownloadUrl(jobId).then((next) => {
      if (!cancelled) setUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [jobId])
  return url
}
