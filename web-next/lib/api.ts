import type { ScanResult, JobStatus } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL

// Helper function to handle API errors
const handleResponse = async (response: Response) => {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'API_ERROR',
      message: `HTTP ${response.status}: ${response.statusText}`
    }))
    throw { code: errorData.error, message: errorData.message }
  }
  return response.json()
}

export async function scanVideo(file: File): Promise<ScanResult> {
  const formData = new FormData()
  formData.append('video', file)

  const response = await fetch(`${BASE}/api/scan-video`, {
    method: 'POST',
    body: formData
  })

  return handleResponse(response)
}

export async function startAnalysis(params: {
  session_token: string | null
  player_index: number | null
}): Promise<{ job_id: string }> {
  const response = await fetch(`${BASE}/api/analyze-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      model: "gemini-2.5-flash"
    })
  })

  return handleResponse(response)
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${BASE}/api/job-status/${jobId}`)
  return handleResponse(response)
}

export function getDownloadUrl(jobId: string): string {
  return `${BASE}/api/download/${jobId}`
}
