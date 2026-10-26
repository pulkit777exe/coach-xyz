// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// ── Three defects in the settings panel, all found by reading ────────────────
//
// `buildSettingsSections` is a PURE function returning `SettingsSection[]`, so its
// behaviour is testable with no DOM, no provider and no fetch: call it, take the
// array, render each section's `content`. That is why these three live in one small
// file rather than inside a `SettingsClient` DOM test that would need twelve module
// mocks and would exercise the wrong layer.
//
// The a11y sweep SKIPS this file, so nothing else observes any of it.

vi.mock('@/lib/preferences', () => ({
  usePreferences: () => ({
    theme: 'light',
    density: 'comfortable',
    reducedMotion: false,
    setTheme: () => undefined,
  }),
}))
// The roster children fetch on mount and are not what these cases are about.
// Unrolled rather than looped: `vi.mock` is hoisted, and vitest rejects a mock
// declared inside a block — which is a helpful error, not a pedantic one.
vi.mock('@/components/org/MembersSection', () => ({ default: () => null }))
vi.mock('@/components/org/ProfileForm', () => ({ default: () => null }))
vi.mock('@/components/org/PreferencesSection', () => ({ default: () => null }))
vi.mock('@/components/org/NotificationsSection', () => ({ default: () => null }))
vi.mock('@/components/org/OrganizationSettingsSection', () => ({ default: () => null }))
vi.mock('@/components/org/PrivacySection', () => ({ default: () => null }))

const baseProps = {
  isDashboard: true,
  identity: {
    sub: 'auth0|user',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    nickname: null,
    picture: null,
    emailVerified: true,
  },
  profile: null,
  emailVerified: true,
  passwordUrl: '/account',
  auth0Id: 'auth0|org',
  role: 'owner',
  students: [] as unknown[],
  overview: null,
  subscription: null,
  orgFailed: false,
}

const build = async (over: Record<string, unknown> = {}) =>
  (await import('@/components/org/settings/buildSettingsSections')).default({
    ...baseProps,
    ...over,
  } as never)

const htmlOf = (sections: Awaited<ReturnType<typeof build>>, id: string) =>
  renderToStaticMarkup(sections.find((s) => s.id === id)!.content)

describe('buildSettingsSections — defects found by reading', () => {
  test('an absent attendance rate renders a dash, never the text "undefined%"', async () => {
    // The tile guarded with `!== null`, so `undefined !== null` was true and the
    // template literal stringified the missing value straight into the dashboard. A
    // wire field typed `number | null` can simply be absent, and this is the shape it
    // takes when it is.
    const sections = await build({ overview: { avg_attendance_rate: undefined } })
    const html = htmlOf(sections, 'records')
    expect(html).not.toContain('undefined%')
    expect(html).not.toContain('undefined')
  })

  test('a null attendance rate still renders a dash', async () => {
    // The other half of the pair: `!= null` must still exclude null. An assertion that
    // only covered `undefined` would also pass against a guard that deleted the
    // condition entirely.
    const sections = await build({ overview: { avg_attendance_rate: null } })
    expect(htmlOf(sections, 'records')).not.toContain('undefined')
  })

  test('a real attendance rate still renders', async () => {
    // And the inverse: the fix must not have broken the happy path, which a
    // "not.toContain('undefined')" assertion cannot tell on its own.
    const sections = await build({ overview: { avg_attendance_rate: 87 } })
    expect(htmlOf(sections, 'records')).toContain('87%')
  })

  test('a players-roster failure says Players, not Members', async () => {
    // `LoadFailed` was one component whose copy read "Members failed to load." and was
    // reused for the PLAYERS pane inside the same `members` section — so an
    // `orgStudents` outage told a coach their members had failed. The wrong noun sends
    // triage to the wrong subsystem.
    //
    // `auth0Id` is set so the members branch renders its real child and the players
    // branch is the one that fails; `students: null` is what selects it.
    const sections = await build({ orgFailed: true, students: null })
    const html = htmlOf(sections, 'members')
    expect(html).toContain('Players failed to load.')
    expect(html).not.toContain('Members failed to load.')
  })

  test('a members-lookup failure still says Members', async () => {
    // The other call site, so a fix that simply reworded the shared copy would fail
    // here instead of shipping a second wrong noun.
    const sections = await build({ orgFailed: true, auth0Id: null })
    const html = htmlOf(sections, 'members')
    expect(html).toContain('Members failed to load.')
  })

  test('a partial subscription object does not take the panel down', async () => {
    // `subscription.subscription.tier` and `subscription.usage_today[...]` were both
    // unguarded dereferences on an async response. The nav entry is gated on
    // `subscription` being non-null, which says nothing about its shape — so a partial
    // payload threw during render and took the whole settings panel with it.
    //
    // The third instance of this in one file (`daily_analysis_limit`) was found by
    // THIS test failing, after the first two had been fixed by reading. That is the
    // argument for writing it even though the fix looked complete.
    const sections = await build({ subscription: {} })
    expect(() =>
      renderToStaticMarkup(sections.find((s) => s.id === 'plan-usage')!.content),
    ).not.toThrow()
    expect(htmlOf(sections, 'plan-usage')).toContain('—')
  })
})
