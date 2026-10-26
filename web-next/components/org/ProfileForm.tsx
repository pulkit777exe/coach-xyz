'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Spinner } from '@/components/org/Spinner'

import { updateMyProfile } from '@/lib/meApi'
import type { CoachAIError } from '@/lib/api'
import type { UserRecord } from '@/lib/api'

export default function ProfileForm({
  initialName,
  initialNickname,
  initialPicture,
  fresh = undefined,
}: {
  initialName: string | null
  initialNickname: string | null
  initialPicture: string | null
  /**
   * Fresh profile record fetched after mount (the session copy goes stale
   * after a save). Applied only while the form is untouched — edits already
   * in flight are never clobbered.
   */
  fresh?: UserRecord | null
}) {
  const [name, setName] = useState(initialName ?? '')
  const [nickname, setNickname] = useState(initialNickname ?? '')
  const [picture, setPicture] = useState(initialPicture ?? '')
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (!fresh || dirtyRef.current) return
    setName(fresh.name ?? '')
    setNickname(fresh.nickname ?? '')
    setPicture(fresh.picture ?? '')
  }, [fresh])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateMyProfile({
        name: name.trim() || null,
        nickname: nickname.trim() || null,
        picture: picture.trim() || null,
      })
      toast.success('Profile updated')
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => {
              dirtyRef.current = true
              setName(e.target.value)
            }}
            placeholder="Your full name"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="nickname">Nickname</Label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => {
              dirtyRef.current = true
              setNickname(e.target.value)
            }}
            placeholder="Coach, boss, Gaffer…"
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="picture">Picture URL</Label>
        <Input
          id="picture"
          type="url"
          value={picture}
          onChange={(e) => {
            dirtyRef.current = true
            setPicture(e.target.value)
          }}
          placeholder="https://…/avatar.jpg"
        />
      </div>
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : 'Save'}
        </Button>
      </div>
    </form>
  )
}
