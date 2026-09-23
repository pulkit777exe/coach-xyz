'use client'

import { useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/9ui/ui/avatar'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  picture?: string | null
  name?: string | null
  email?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Sidebar/topbar sizes: sm = 24px (20–24px Notion range), md = 32px, lg = 56px. */
const sizeClasses = {
  sm: 'size-6! text-[0.5rem]!',
  md: 'size-8! text-xs!',
  lg: 'size-14! text-lg!',
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

export default function UserAvatar({
  picture,
  name,
  email,
  size = 'md',
  className = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const showImage = Boolean(picture) && !imgError

  return (
    <Avatar className={cn('font-medium', sizeClasses[size], className)}>
      {showImage ? (
        <AvatarImage
          src={picture!}
          alt={name || email || 'Profile'}
          onError={() => setImgError(true)}
        />
      ) : null}
      <AvatarFallback>{getInitials(name, email)}</AvatarFallback>
    </Avatar>
  )
}
