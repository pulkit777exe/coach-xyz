'use client'

import { useState } from 'react'

interface UserAvatarProps {
  picture?: string | null
  name?: string | null
  email?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-6 h-6 text-[0.5rem]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-14 h-14 text-lg',
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return parts[0].substring(0, 2).toUpperCase()
  }
  if (email) {
    return email.substring(0, 2).toUpperCase()
  }
  return '?'
}

export default function UserAvatar({ picture, name, email, size = 'md', className = '' }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const showImage = picture && !imgError

  return (
    <div
      className={`rounded-full border border-[var(--cream-10)] flex items-center justify-center bg-[var(--cream-05)] text-[var(--cream-40)] font-medium ${sizeClasses[size]} ${className}`}
    >
      {showImage ? (
        <img
          src={picture}
          alt={name || email || 'Profile'}
          className="w-full h-full rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span>{getInitials(name, email)}</span>
      )}
    </div>
  )
}
