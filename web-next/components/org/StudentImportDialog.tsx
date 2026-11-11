'use client'

import { useState } from 'react'
import { UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/9ui/ui/button'
import { Label } from '@/components/9ui/ui/label'
import { Textarea } from '@/components/9ui/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/9ui/ui/dialog'
import { Spinner } from './Spinner'
import { parseCSV } from '@/lib/csv'
import { orgImportStudents } from '@/lib/org/students'
import type { StudentImportResult, StudentImportRow } from '@/lib/org/types'
import type { CoachAIError } from '@/lib/data/errors'

const IMPORT_COLUMN_FIELDS = [
  'full_name',
  'email',
  'phone',
  'sport',
  'position',
  'jersey_number',
  'date_of_birth',
  'gender',
  'guardian_name',
  'guardian_phone',
  'notes',
  'status',
  'joined_on',
] as const

const IMPORT_COLUMN_ALIASES: Record<string, string> = {
  'full name': 'full_name',
  name: 'full_name',
  student: 'full_name',
  'student name': 'full_name',
  email: 'email',
  phone: 'phone',
  'phone number': 'phone',
  sport: 'sport',
  position: 'position',
  jersey: 'jersey_number',
  'jersey number': 'jersey_number',
  'jersey #': 'jersey_number',
  dob: 'date_of_birth',
  'date of birth': 'date_of_birth',
  gender: 'gender',
  'guardian name': 'guardian_name',
  'guardian phone': 'guardian_phone',
  notes: 'notes',
  status: 'status',
  joined: 'joined_on',
  'joined on': 'joined_on',
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ')

const toJerseyNumber = (value: string): string | number =>
  /^\d+(\.\d+)?$/.test(value) ? Number(value) : value

function looksLikeHeaderRow(cells: string[], normalized: string[]): boolean {
  const resolved = normalized.filter((h) => IMPORT_COLUMN_ALIASES[h])
  if (resolved.length < 2) return false

  const DATA_SHAPED =
    /@|\d{2,}[-/.]\d{1,2}[-/.]\d{2,}|\b\d{3}[- .]?\d{3}[- .]?\d{4}\b|^\+?[0-9][0-9 ()/-]{6,}$/
  return !cells.some((raw) => DATA_SHAPED.test(raw.trim()))
}

export function csvToImportRows(csv: string): StudentImportRow[] {
  const records = parseCSV(csv)
  if (!records.length) return []

  const header = records[0].map(normalizeHeader)
  const hasHeader = looksLikeHeaderRow(records[0], header)
  const mapping: (string | null)[] = hasHeader
    ? header.map((h) => IMPORT_COLUMN_ALIASES[h] ?? null)
    : []
  const body = hasHeader ? records.slice(1) : records

  return body
    .map((cells) => {
      const row: StudentImportRow = {}
      cells.forEach((cell, idx) => {
        const field = hasHeader ? mapping[idx] : IMPORT_COLUMN_FIELDS[idx]
        if (!field) return
        const value = cell.trim()
        if (value === '') return
        ;(row as Record<string, string | number>)[field] =
          field === 'jersey_number' ? toJerseyNumber(value) : value
      })
      return row
    })
    .filter((r) => Object.keys(r).length > 0)
}

export function StudentImportDialog({
  open,
  onOpenChange,
  auth0Id,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  auth0Id: string
  onImported: () => void | Promise<void>
}) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<StudentImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StudentImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setText('')
    setFileName(null)
    setRows([])
    setResult(null)
    setError(null)
  }

  const applyText = (value: string) => {
    setText(value)
    const parsed = csvToImportRows(value)
    setRows(parsed)
    setResult(null)
    setError(parsed.length ? null : 'No rows found — paste CSV text or pick a .csv file.')
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    applyText(await file.text())
  }

  const runImport = async () => {
    if (!rows.length) return
    setBusy(true)
    setError(null)
    try {
      const res = await orgImportStudents(auth0Id, rows)
      setResult(res)
      if (res.imported > 0) await onImported()
      if (res.imported === 0 && res.failed.length > 0) {
        toast.error('No rows imported — review the errors below')
      }
    } catch (err) {
      setError((err as CoachAIError).message ?? 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import students from CSV</DialogTitle>
          <DialogDescription>
            Upload a .csv or paste rows. The first row is matched against known column headers (Full
            name, Email, Status, &hellip;); otherwise columns are read in roster export order. Bad
            rows are skipped individually &mdash; the rest still import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="import-file"
              className="border-border bg-background text-muted-foreground hover:text-foreground flex h-9 cursor-pointer items-center gap-2 rounded-[6px] border px-3 text-body"
            >
              <UploadIcon className="size-4" />
              Choose CSV file
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onFile}
              />
            </Label>
            {fileName ? (
              <span className="text-muted-foreground truncate text-caption leading-4">
                {fileName}
              </span>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="import-paste" className="text-body font-medium">
              …or paste CSV
            </Label>
            <Textarea
              id="import-paste"
              value={text}
              onChange={(e) => applyText(e.target.value)}
              rows={6}
              className="font-mono text-caption leading-4"
              placeholder={'full_name,email,status\nAlex Rivera,a@x.com,active'}
            />
          </div>

          {rows.length > 0 && (
            <div>
              <p className="mb-2 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {rows.length} row(s) parsed — first {Math.min(rows.length, 8)} shown
              </p>
              <div className="border-border max-h-48 overflow-auto rounded-[6px] border">
                <table className="w-full text-meta">
                  <caption className="sr-only">Preview of parsed student rows</caption>
                  <thead>
                    <tr className="border-b border-border text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      <th scope="col" className="px-3 py-2 text-left">Name</th>
                      <th scope="col" className="px-3 py-2 text-left">Email</th>
                      <th scope="col" className="px-3 py-2 text-left">Sport</th>
                      <th scope="col" className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="text-foreground px-3 py-1.5">{r.full_name ?? '—'}</td>
                        <td className="text-muted-foreground px-3 py-1.5">{r.email ?? '—'}</td>
                        <td className="text-muted-foreground px-3 py-1.5">{r.sport ?? '—'}</td>
                        <td className="text-muted-foreground px-3 py-1.5">{r.status ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error ? <p className="text-meta text-destructive">{error}</p> : null}

          {result ? (
            <div className="border-border bg-muted/40 space-y-1 rounded-[6px] border p-3 text-meta">
              <p className="text-foreground font-medium">{result.imported} imported</p>
              {result.duplicates_skipped > 0 ? (
                <p className="text-muted-foreground">
                  {result.duplicates_skipped} duplicate(s) skipped by email
                </p>
              ) : null}
              {result.failed.length > 0 ? (
                <ul className="text-muted-foreground max-h-32 list-disc space-y-0.5 overflow-auto pl-5">
                  {result.failed.map((f) => (
                    <li key={`${f.row_index}-${f.reason}`}>
                      Row {f.row_index + 1}: {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button onClick={runImport} disabled={busy || rows.length === 0}>
            {busy ? <Spinner /> : <UploadIcon />} Import{' '}
            {rows.length > 0 ? `${rows.length} student(s)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default StudentImportDialog
