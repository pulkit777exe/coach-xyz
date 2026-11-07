import { initials } from '@/lib/initials'
import { ORG_MEMBER_ROLE_LABELS, type OrgMember, type OrgMemberRole } from '@/lib/members'
import StatusPill, { type StatusTone } from '@/components/org/StatusPill'

function roleTone(role: OrgMemberRole): StatusTone {
  if (role === 'owner') return 'primary'
  if (role === 'head_coach') return 'blue'
  return 'gray'
}

export function MemberRow({ member }: { member: OrgMember }) {
  const name = member.display_name ?? member.member_email ?? 'Member'
  return (
    <li className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-[4px] bg-muted text-label font-medium text-muted-foreground">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body leading-5 font-medium text-foreground">{name}</p>
        <p className="truncate text-meta text-muted-foreground">
          {member.member_email ?? 'No email on file'}
        </p>
      </div>
      <StatusPill tone={roleTone(member.role)} className="shrink-0">
        {ORG_MEMBER_ROLE_LABELS[member.role]}
      </StatusPill>
    </li>
  )
}

export default MemberRow
