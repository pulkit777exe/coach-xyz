'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/9ui/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/9ui/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import type { AuditLog } from '@/lib/members'

interface AuditClientProps {
  initialLogs: AuditLog[]
}

const ACTION_GROUPS = [
  'member.invited',
  'member.invite_accepted',
  'member.invite_revoked',
  'member.role_changed',
  'member.removed',
  'team.created',
  'team.renamed',
  'team.deleted',
  'team.member_added',
  'team.member_removed',
  'analysis.cancelled',
  'analysis.deleted',
  'video.exported',
  'video.viewed',
  'report.exported',
  'settings.changed',
  'player.created',
  'player.transferred',
  'health.record_viewed',
  'clip.created',
  'clip.deleted',
] as const

export default function AuditClient({ initialLogs }: AuditClientProps) {
  const [filter, setFilter] = useState<string>('')

  const logs = useMemo(
    () => (filter ? initialLogs.filter((l) => l.action === filter) : initialLogs),
    [initialLogs, filter],
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>
              Sensitive organization actions, newest first. {logs.length} shown.
            </CardDescription>
          </div>
          <Select
            items={{ '': 'All actions', ...Object.fromEntries(ACTION_GROUPS.map((a) => [a, a])) }}
            value={filter}
            onValueChange={(v) => setFilter(typeof v === 'string' ? v : '')}
          >
            <SelectTrigger aria-label="Filter by action" className="w-56">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All actions</SelectItem>
              {ACTION_GROUPS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {logs.length === 0 && (
          <p className="text-sm text-muted-foreground">No audit entries yet.</p>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground font-mono">{log.action}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {log.actor_auth0_id ?? 'system'} · {log.resource_type}
                {log.resource_id ? ` · ${log.resource_id.slice(0, 8)}` : ''} ·{' '}
                {new Date(log.created_at).toLocaleString()}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                log.result && log.result !== 'ok' ? 'border-destructive/40 text-destructive' : ''
              }
            >
              {log.result ?? 'ok'}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
