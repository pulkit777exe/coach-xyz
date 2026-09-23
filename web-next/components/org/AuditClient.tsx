'use client'

import { useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/9ui/ui/select'
import EmptyState from './EmptyState'
import Section from './Section'
import StatusPill from './StatusPill'
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
    <Section
      title="Audit log"
      actions={
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
      }
    >
      <p className="mb-3 text-[13px] text-muted-foreground">
        Sensitive organization actions, newest first.{' '}
        <span className="tabular-nums">{logs.length}</span> shown.
      </p>
      <div>
        {logs.length === 0 && (
          <EmptyState compact title="No audit entries yet" />
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 hover:bg-accent/50 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-foreground font-mono">{log.action}</p>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground tabular-nums">
                {log.actor_auth0_id ?? 'system'} · {log.resource_type}
                {log.resource_id ? ` · ${log.resource_id.slice(0, 8)}` : ''} ·{' '}
                {new Date(log.created_at).toLocaleString()}
              </p>
            </div>
            <StatusPill tone={log.result && log.result !== 'ok' ? 'red' : 'gray'}>
              {log.result ?? 'ok'}
            </StatusPill>
          </div>
        ))}
      </div>
    </Section>
  )
}
