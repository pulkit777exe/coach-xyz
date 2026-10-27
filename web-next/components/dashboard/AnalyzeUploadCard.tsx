'use client'

import { useState, useCallback } from 'react'
import { Upload, FileVideo, Play } from 'lucide-react'
import { MAX_FILE_SIZE_BYTES } from '@/types'

interface AnalyzeUploadCardProps {
  onFileSelected: (file: File) => void
}

/**
 * Dashboard-styled upload card: the idle (first) state of the analyze flow.
 * Validates file type + size client-side before handing the file to the
 * pipeline (`handleFileSelected` in useScanFlow/usePipeline).
 */
export function AnalyzeUploadCard({ onFileSelected }: AnalyzeUploadCardProps) {
  const [dragActive, setDragActive] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer.files[0]
      if (file) onFileSelected(file)
    },
    [onFileSelected]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(true)
    },
    []
  )

  const handleDragLeave = useCallback(() => setDragActive(false), [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFileSelected(file)
    },
    [onFileSelected]
  )

  const maxSizeMB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))

  return (
    <div className="flex min-h-[560px] flex-col items-center justify-center bg-background">
      <div
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full max-w-2xl rounded-[6px] border-2 border-dashed ${
          dragActive ? 'border-primary bg-primary/5' : 'border-border bg-card'
        } p-12 text-center transition-colors hover:border-primary/50`}
      >
        <Upload className="mx-auto mb-4 size-6 text-muted-foreground" />
        <h3 className="text-lead font-semibold text-foreground">Upload a video</h3>
        <p className="mt-2 text-meta text-muted-foreground">
          Drag & drop an MP4, MOV or AVI (up to {maxSizeMB} MB), or click to browse.
        </p>
        <input
          id="analyze-video-upload"
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={handleFileInput}
        />
        <label
          htmlFor="analyze-video-upload"
          className="mt-6 inline-flex items-center gap-2 rounded-[6px] border border-border bg-background px-5 py-2.5 text-body font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer"
        >
          <FileVideo className="size-4" aria-hidden />
          Choose a video
        </label>
        <p className="mt-3 text-caption text-muted-foreground">
          {maxSizeMB} MB max • Auto player detection & Gemini AI form scoring
        </p>
      </div>

      <div className="mt-10 flex flex-col items-center gap-3 text-meta text-muted-foreground text-body leading-5 sm:flex-row">
        <div className="flex items-center gap-2">
          <Play className="size-4 text-muted-foreground" />
          <span>Coach reviews every rep</span>
        </div>
        <span className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-foreground">AI form scoring</span>
        </div>
        <span className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-foreground">Chat about the video</span>
        </div>
      </div>
    </div>
  )
}
