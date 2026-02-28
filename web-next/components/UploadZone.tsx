'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'

interface UploadZoneProps {
  onFileSelected: (file: File) => void
}

export default function UploadZone({ onFileSelected }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files.length > 0) {
      onFileSelected(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelected(e.target.files[0])
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div
        className={`border-2 border-dashed rounded-2xl p-16 text-center transition-colors ${
          isDragging
            ? 'border-indigo-400 bg-gray-900'
            : 'border-gray-700 hover:border-indigo-500'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileChange}
        />
        
        {/* Video Icon */}
        <svg
          className="w-16 h-16 mx-auto mb-6 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>

        <h1 className="text-2xl font-semibold text-white mb-2">
          Drop your training video here
        </h1>
        <p className="text-gray-400 mb-8">
          or click to browse · MP4, MOV, AVI, MKV · Max 500MB
        </p>
        
        <Button
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
          size="lg"
        >
          Choose Video File
        </Button>
      </div>
    </div>
  )
}
