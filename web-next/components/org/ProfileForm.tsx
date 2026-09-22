'use client'

import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import { Spinner } from '@/components/org/Spinner'

import { updateMyProfile } from '@/lib/meApi'
import type { CoachAIError } from '@/lib/api'

export default function ProfileForm({
  initialName,
  initialNickname,
  initialPicture,
}: {
  initialName: string | null
  initialNickname: string | null
  initialPicture: string | null
}) {
  const [name, setName] = useState(initialName ?? '')
  const [nickname, setNickname] = useState(initialNickname ?? '')
  const [picture, setPicture] = useState(initialPicture ?? '')
  const [saving, setSaving] = useState(false)

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
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            className="border-border bg-transparent"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nickname">Nickname</Label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Coach, boss, Gaffer…"
            className="border-border bg-transparent"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="picture">Picture URL</Label>
        <Input
          id="picture"
          type="url"
          value={picture}
          onChange={(e) => setPicture(e.target.value)}
          placeholder="https://…/avatar.jpg"
          className="border-border bg-transparent"
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
