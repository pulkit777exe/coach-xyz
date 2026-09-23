'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import { Textarea } from '@/components/9ui/ui/textarea'
import { Spinner } from './Spinner'
import { NativeSelect } from './EventFormDialog'

import type { Student, StudentFormValues } from '@/lib/org'
import { orgCreateStudent, orgUpdateStudent, STUDENT_STATUSES } from '@/lib/org'
import { getSportPositions, type SportPosition } from '@/lib/sports'
import type { CoachAIError } from '@/lib/api'

const STATUSES = STUDENT_STATUSES
const GENDERS = ['female', 'male', 'other'] as const

export type StudentFormDialogProps = {
  auth0Id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  student?: Student | null
  sports: string[]
  teams?: { id: string; name: string }[]
  onCreated: (student: Student) => void
  onUpdated: (student: Student) => void
}

const emptyForm = (sports: string[]): Partial<StudentFormValues> => ({
  full_name: '',
  sport: sports[0] ?? '',
  status: 'active',
})

export default function StudentFormDialog({
  auth0Id,
  open,
  onOpenChange,
  student,
  sports,
  teams = [],
  onCreated,
  onUpdated,
}: StudentFormDialogProps) {
  const editing = Boolean(student)
  const [form, setForm] = useState<Partial<StudentFormValues> | null>(
    student ? { ...student } : null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<SportPosition[]>([])
  const [positionsForSport, setPositionsForSport] = useState('')
  const positionsSeq = useRef(0)

  const loadPositions = (sport: string) => {
    const seq = ++positionsSeq.current
    setPositionsForSport(sport)
    setPositions([])
    if (!sport) return
    void getSportPositions(sport).then((list) => {
      if (positionsSeq.current === seq) setPositions(list)
    })
  }

  const values: Partial<StudentFormValues> =
    form ??
    (editing && student ? ({ ...student } as Partial<StudentFormValues>) : emptyForm(sports))

  const set = <K extends keyof StudentFormValues>(key: K, value: StudentFormValues[K] | '') => {
    setForm((f) => ({ ...(f ?? emptyForm(sports)), [key]: value }))
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setForm(null)
      setError(null)
    } else {
      // Load the position vocabulary for the current sport when the dialog
      // opens (explicit event, not an effect — keeps lint's set-state rule
      // happy and avoids refetch loops on keystrokes).
      const sport = (form?.sport ?? student?.sport ?? sports[0] ?? '') as string
      if (sport !== positionsForSport) loadPositions(sport)
    }
    onOpenChange(next)
  }

  const handleSportChange = (v: string) => {
    set('sport', v)
    if (v !== positionsForSport) loadPositions(v)
  }

  const submit = async () => {
    if (!values.full_name?.trim()) {
      setError('Full name is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      const numbered = ['jersey_number'] as const
      const dates = ['date_of_birth', 'joined_on'] as const
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue
        if ((numbered as readonly string[]).includes(key)) {
          if (value === '' || value === null) {
            if (editing) payload[key] = null
            continue
          }
          const n = Number(value)
          if (Number.isFinite(n)) payload[key] = n
          continue
        }
        if ((dates as readonly string[]).includes(key)) {
          if (value === '' || value === null) {
            if (editing) payload[key] = null
            continue
          }
          payload[key] = String(value)
          continue
        }
        if (value === null) continue
        if (value === '') {
          if (editing) payload[key] = null
          continue
        }
        payload[key] = value
      }
      if (editing && student) {
        const res = await orgUpdateStudent(
          auth0Id,
          student.id,
          payload as Partial<StudentFormValues>,
        )
        toast.success('Student updated')
        onUpdated(res.student)
      } else {
        const res = await orgCreateStudent(auth0Id, payload as Partial<StudentFormValues>)
        toast.success('Student added')
        onCreated(res.student)
      }
      handleOpenChange(false)
    } catch (err) {
      const e = err as CoachAIError
      setError(e.message ?? 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {' '}
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Student' : 'Add Student'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="full_name">Full name *</Label>
            <Input
              id="full_name"
              value={values.full_name ?? ''}
              onChange={(e) => set('full_name', e.target.value)}
              placeholder="e.g. Alex Rivera"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={values.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Use the student’s login email to auto-link their player account.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={values.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="sport">Sport</Label>
              <NativeSelect
                id="sport"
                value={values.sport ?? ''}
                onChange={handleSportChange}
                options={
                  sports.length
                    ? sports
                    : ['Academy', 'Tennis', 'Cricket', 'Football', 'Basketball']
                }
                placeholder="Select sport"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="position">Position</Label>
              {positions.length > 0 ? (
                <PositionSelect
                  positions={positions}
                  value={(values.position as string | undefined) ?? ''}
                  onChange={(v) => set('position', v)}
                />
              ) : (
                <Input
                  id="position"
                  value={values.position ?? ''}
                  onChange={(e) => set('position', e.target.value)}
                  placeholder="e.g. Goalkeeper"
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jersey_number">Jersey #</Label>
              <Input
                id="jersey_number"
                type="number"
                value={values.jersey_number ?? ''}
                onChange={(e) => set('jersey_number', e.target.value as never)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="date_of_birth">Date of birth</Label>
              <Input
                id="date_of_birth"
                type="date"
                value={values.date_of_birth ?? ''}
                onChange={(e) => set('date_of_birth', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gender">Gender</Label>
              <NativeSelect
                id="gender"
                value={values.gender ?? ''}
                onChange={(v) => set('gender', v)}
                options={[...GENDERS]}
                placeholder="—"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <NativeSelect
                id="status"
                value={values.status ?? 'active'}
                onChange={(v) => set('status', v as StudentFormValues['status'])}
                options={[...STATUSES]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="joined_on">Joined</Label>
              <Input
                id="joined_on"
                type="date"
                value={values.joined_on ?? ''}
                onChange={(e) => set('joined_on', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="team">Team</Label>
              <Select
                items={{
                  __none: 'No team',
                  ...Object.fromEntries(teams.map((t) => [t.id, t.name])),
                }}
                value={values.team_id ?? '__none'}
                onValueChange={(v) =>
                  set('team_id', v === '__none' ? '' : typeof v === 'string' ? v : '')
                }
              >
                <SelectTrigger id="team">
                  <SelectValue placeholder="No team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No team</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="guardian_name">Guardian name</Label>
              <Input
                id="guardian_name"
                value={values.guardian_name ?? ''}
                onChange={(e) => set('guardian_name', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guardian_phone">Guardian phone</Label>
              <Input
                id="guardian_phone"
                value={values.guardian_phone ?? ''}
                onChange={(e) => set('guardian_phone', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={values.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Medical notes, strengths, focus areas…"
            />
          </div>

          {error && <p className="text-sm text-(--danger)">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Spinner /> : editing ? 'Save changes' : 'Add student'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Position picker backed by the sport-pack vocabulary. Stores the human
 * label (what profiles display). A legacy/custom value absent from the
 * vocab is kept as an extra option so editing never blanks it; __none
 * clears back to free text on the next sport without vocab.
 */
function PositionSelect({
  positions,
  value,
  onChange,
}: {
  positions: SportPosition[]
  value: string
  onChange: (v: string) => void
}) {
  const labels = positions.map((p) => p.label)
  const items: Record<string, string> = Object.fromEntries([
    ['__none', 'No position'],
    ...labels.map((l): [string, string] => [l, l]),
    ...(!value || value === '__none' || labels.includes(value)
      ? []
      : [[value, value] as [string, string]]),
  ])
  return (
    <Select
      items={items}
      value={value || '__none'}
      onValueChange={(v) => onChange(typeof v === 'string' && v !== '__none' ? v : '')}
    >
      <SelectTrigger id="position">
        <SelectValue placeholder="Select position" />
      </SelectTrigger>
      <SelectContent>
        {Object.keys(items).map((k) => (
          <SelectItem key={k} value={k}>
            {items[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
