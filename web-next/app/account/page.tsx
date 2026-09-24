import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { syncUser } from '@/lib/api'
import { redirect } from 'next/navigation'
import UserAvatar from '@/components/UserAvatar'
import PageHeader from '@/components/org/PageHeader'
import StatusPill from '@/components/org/StatusPill'
import { USER_ROLE_LABELS } from '@/lib/userRoles'

export const metadata: Metadata = {
  title: 'Account | CoachXYZ',
  description: 'Manage your CoachXYZ account and profile.',
}

/** Parse the Auth0 `sub` claim to a human-readable provider label.
 *  Examples: "google-oauth2|123" → "Google", "github|456" → "GitHub",
 *  "auth0|789" → "Email / Password"
 */
function parseProvider(sub: string): string {
  const prefix = sub.split('|')[0] ?? ''
  if (prefix === 'google-oauth2') return 'Google'
  if (prefix === 'github') return 'GitHub'
  if (prefix === 'auth0') return 'Email / Password'
  if (prefix === 'windowslive') return 'Microsoft'
  if (prefix === 'facebook') return 'Facebook'
  return prefix || 'Unknown'
}

export default async function AccountPage() {
  const session = await getSession()

  if (!session) {
    redirect('/auth/login')
  }

  const provider = parseProvider(session.user.sub)

  let user = null
  let syncError = null
  try {
    const result = await syncUser({
      sub: session.user.sub,
      email: session.user.email,
      name: session.user.name,
      nickname: session.user.nickname,
      picture: session.user.picture,
      email_verified: session.user.email_verified,
    })
    user = result.user
  } catch (error) {
    console.error('Failed to sync user with backend:', error)
    syncError = error instanceof Error ? error.message : 'Failed to sync profile data'
  }

  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-background pb-12">
      <div className="mx-auto max-w-[720px] px-6 py-6 lg:px-8">
        <PageHeader trail={['Home', 'Account']} title="Account" />

        {syncError && (
          <div className="mt-4 rounded-[6px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
            Failed to sync profile data. Some information may be outdated.
          </div>
        )}

        <div className="mt-6 rounded-[6px] border border-border bg-card">
          <div className="border-b border-border px-6 py-3.5">
            <p className="text-[16px] font-semibold text-foreground">Profile</p>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-4">
              <UserAvatar
                picture={session.user.picture}
                name={session.user.name}
                email={session.user.email}
                size="lg"
              />
              <div>
                <p className="text-[16px] font-semibold text-foreground">
                  {session.user.name || 'No name'}
                </p>
                <p className="text-[14px] text-muted-foreground">{session.user.email}</p>
              </div>
            </div>
            <div className="mt-6 divide-y divide-border rounded-[6px] border border-border overflow-hidden">
              {[
                { label: 'Email', value: session.user.email },
                { label: 'Name', value: session.user.name || '—' },
                { label: 'Nickname', value: session.user.nickname || '—' },
                { label: 'Signed in with', value: provider },
                { label: 'Email Verified', value: session.user.email_verified ? 'Yes' : 'No' },
                { label: 'User ID', value: session.user.sub, mono: true },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 bg-card px-4 py-3"
                >
                  <span className="text-[13px] font-medium text-muted-foreground">
                    {row.label}
                  </span>
                  <span
                    className={`text-[14px] text-foreground truncate max-w-[260px] text-right tabular-nums ${row.mono ? 'font-mono text-[13px]' : ''}`}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {user && (
          <div className="mt-4 rounded-[6px] border border-border bg-card">
            <div className="border-b border-border px-6 py-3.5">
              <p className="text-[16px] font-semibold text-foreground">Database Record</p>
            </div>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between px-6 py-3.5">
                <span className="text-[13px] font-medium text-muted-foreground">Role</span>
                <StatusPill tone="primary">
                  {user.role ? (USER_ROLE_LABELS[user.role] ?? user.role) : '—'}
                </StatusPill>
              </div>
              <div className="flex items-center justify-between px-6 py-3.5">
                <span className="text-[13px] font-medium text-muted-foreground">Created</span>
                <span className="text-[13px] text-foreground tabular-nums">
                  {new Date(user.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between px-6 py-3.5">
                <span className="text-[13px] font-medium text-muted-foreground">
                  Last Updated
                </span>
                <span className="text-[13px] text-foreground tabular-nums">
                  {new Date(user.updated_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-[6px] border border-border bg-card px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]"
          >
            Back to Home
          </Link>
          <a
            href="/auth/logout"
            className="inline-flex h-9 items-center rounded-[6px] bg-destructive px-4 text-[14px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]"
          >
            Log Out
          </a>
        </div>
      </div>
    </main>
  )
}
