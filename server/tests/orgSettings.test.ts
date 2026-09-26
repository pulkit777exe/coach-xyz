import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'
import {
  isIanaTimezone,
  ORG_NAME_MAX_LENGTH,
  orgSettings,
  updateOrgSettings,
  validateOrgSettingsPatch,
} from '../src/lib/orgData'
import settingsRoutes from '../src/routes/org/settings'

// ── Organization settings ────────────────────────────────────────────────────
// Hermetic: the store is stubbed through the documented test seam, so these
// cases never depend on whether the live database has been migrated with
// `organizations.timezone` yet. Route cases drive the real Elysia module so the
// service guard AND the owner/admin role floor are both exercised.

type StoredOrg = {
  auth0_id: string
  name: string | null
  timezone: string | null
  created_at: string
}

type StubMember = {
  member_auth0_id: string | null
  role: string
  display_name?: string | null
}

type StubState = {
  org: StoredOrg | null
  members: StubMember[]
}

const makeStubConnection = (state: StubState): SQL => {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()

    // Schema probe — report the column as present so the stub never DDLs.
    if (query.includes('information_schema.columns')) return [{ column_name: 'timezone' }]

    // getMemberRole: the service guard resolving a non-owner caller's role.
    if (query.includes('from org_members') && query.includes("status = 'active'")) {
      const [orgAuth0Id, memberAuth0Id] = values as [string, string]
      const match = state.members.find(
        (m) => m.member_auth0_id === memberAuth0Id && m.member_auth0_id !== orgAuth0Id,
      )
      return match ? [{ role: match.role }] : []
    }

    // listOrgMembers: the role guard reading the full membership.
    if (query.includes('from org_members m')) {
      return state.members.map((m) => ({
        member_auth0_id: m.member_auth0_id,
        member_email: null,
        role: m.role,
        status: 'active',
        display_name: m.display_name ?? null,
        picture: null,
        created_at: new Date(0).toISOString(),
      }))
    }

    // Owner-row seeding (ensureOrgOwner / listOrgMembers / getMemberRole).
    if (query.includes('insert into org_members')) return []

    if (query.includes('from organizations')) {
      return state.org ? [{ ...state.org }] : []
    }

    if (query.includes('insert into organizations')) {
      const [auth0Id, name, timezone] = values as [string, string | null, string | null]
      state.org = {
        auth0_id: auth0Id,
        name: name ?? null,
        timezone: timezone ?? null,
        created_at: state.org?.created_at ?? new Date().toISOString(),
      }
      return [{ ...state.org }]
    }

    return []
  }) as unknown as SQL

  return Object.assign(tag, {
    connect: async () => {},
    unsafe: () => '',
    close: async () => {},
  }) as SQL
}

let restoreConnection: (() => void) | null = null

const useStub = (state: StubState = { org: null, members: [] }): StubState => {
  restoreConnection = setHistoryStoreConnectionForTests(makeStubConnection(state))
  return state
}

afterEach(() => {
  restoreConnection?.()
  restoreConnection = null
})

describe('org settings data layer', () => {
  test('returns empty settings when the org has no row', async () => {
    useStub()
    expect(await orgSettings('auth0|never-synced')).toEqual({
      name: null,
      timezone: null,
      createdAt: null,
    })
  })

  test('returns empty settings when the history store is disabled', async () => {
    restoreConnection = setHistoryStoreConnectionForTests(null)
    expect(await orgSettings('auth0|no-db')).toEqual({
      name: null,
      timezone: null,
      createdAt: null,
    })
  })

  test('reads back the stored name, timezone and creation stamp', async () => {
    const state = useStub()
    state.org = {
      auth0_id: 'auth0|club',
      name: 'Riverside FC',
      timezone: 'America/New_York',
      created_at: '2026-01-02T03:04:05.000Z',
    }

    expect(await orgSettings('auth0|club')).toEqual({
      name: 'Riverside FC',
      timezone: 'America/New_York',
      createdAt: '2026-01-02T03:04:05.000Z',
    })
  })

  test('creates the row for an org that was never synced through ensureOrg', async () => {
    const state = useStub()

    const saved = await updateOrgSettings('auth0|fresh-org', { name: 'Fresh Club' })
    expect(saved?.name).toBe('Fresh Club')
    expect(saved?.timezone).toBeNull()
    expect(state.org?.auth0_id).toBe('auth0|fresh-org')
  })

  test('a partial patch preserves the field it omits', async () => {
    const state = useStub()
    state.org = {
      auth0_id: 'auth0|club',
      name: 'Riverside FC',
      timezone: 'America/New_York',
      created_at: '2026-01-02T03:04:05.000Z',
    }

    const afterNameOnly = await updateOrgSettings('auth0|club', { name: 'Riverside Athletic' })
    expect(afterNameOnly?.name).toBe('Riverside Athletic')
    expect(afterNameOnly?.timezone).toBe('America/New_York')
    expect(afterNameOnly?.createdAt).toBe('2026-01-02T03:04:05.000Z')

    const afterTimezoneOnly = await updateOrgSettings('auth0|club', { timezone: 'Europe/London' })
    expect(afterTimezoneOnly?.name).toBe('Riverside Athletic')
    expect(afterTimezoneOnly?.timezone).toBe('Europe/London')
    // created_at is preserved by the merge — only updated_at moves.
    expect(afterTimezoneOnly?.createdAt).toBe('2026-01-02T03:04:05.000Z')
  })

  test('an explicit null timezone clears the stored zone', async () => {
    const state = useStub()
    state.org = {
      auth0_id: 'auth0|club',
      name: 'Riverside FC',
      timezone: 'America/New_York',
      created_at: '2026-01-02T03:04:05.000Z',
    }

    const cleared = await updateOrgSettings('auth0|club', { timezone: null })
    expect(cleared?.timezone).toBeNull()
    expect(cleared?.name).toBe('Riverside FC')
    expect(state.org?.timezone).toBeNull()
  })

  test('a name-only patch never touches the timezone column value', async () => {
    const state = useStub()
    state.org = {
      auth0_id: 'auth0|club',
      name: 'Riverside FC',
      timezone: 'America/Chicago',
      created_at: '2026-01-02T03:04:05.000Z',
    }

    await updateOrgSettings('auth0|club', { name: 'Riverside FC 2026' })
    expect(state.org?.timezone).toBe('America/Chicago')
  })

  test('an empty patch is rejected by validation before any write', async () => {
    const state = useStub()
    state.org = {
      auth0_id: 'auth0|club',
      name: 'Riverside FC',
      timezone: 'America/New_York',
      created_at: '2026-01-02T03:04:05.000Z',
    }

    expect(validateOrgSettingsPatch({})).toEqual({
      ok: false,
      message: 'Provide at least one of name or timezone',
    })
    expect(state.org?.name).toBe('Riverside FC')
  })
})

describe('isIanaTimezone', () => {
  test('accepts real IANA zones, including UTC', () => {
    for (const zone of ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata']) {
      expect(isIanaTimezone(zone)).toBe(true)
    }
  })

  test('rejects empty, bogus and non-zone strings', () => {
    for (const zone of ['', '   ', 'Mars/Olympus', 'America/Nowhere', 'PST', 'GMT+5']) {
      expect(isIanaTimezone(zone)).toBe(false)
    }
  })
})

describe('validateOrgSettingsPatch', () => {
  test('accepts a full patch and trims the name', () => {
    expect(
      validateOrgSettingsPatch({ name: '  Riverside FC  ', timezone: 'Europe/Berlin' }),
    ).toEqual({ ok: true, value: { name: 'Riverside FC', timezone: 'Europe/Berlin' } })
  })

  test('accepts a name-only patch, a timezone-only patch, and a null timezone', () => {
    expect(validateOrgSettingsPatch({ name: 'Riverside FC' })).toEqual({
      ok: true,
      value: { name: 'Riverside FC' },
    })
    expect(validateOrgSettingsPatch({ timezone: 'UTC' })).toEqual({
      ok: true,
      value: { timezone: 'UTC' },
    })
    expect(validateOrgSettingsPatch({ timezone: null })).toEqual({
      ok: true,
      value: { timezone: null },
    })
  })

  test('rejects a non-object body', () => {
    expect(validateOrgSettingsPatch(null)).toEqual({
      ok: false,
      message: 'Body must be a JSON object',
    })
    expect(validateOrgSettingsPatch(['Riverside FC'])).toEqual({
      ok: false,
      message: 'Body must be a JSON object',
    })
  })

  test('rejects an unknown field', () => {
    expect(validateOrgSettingsPatch({ name: 'Riverside FC', slug: 'riverside' })).toEqual({
      ok: false,
      message: 'Unknown field: slug',
    })
    expect(validateOrgSettingsPatch({ createdBy: 'auth0|someone' })).toEqual({
      ok: false,
      message: 'Unknown field: createdBy',
    })
  })

  test('rejects an empty or whitespace-only name', () => {
    expect(validateOrgSettingsPatch({ name: '' })).toEqual({
      ok: false,
      message: 'name must not be empty',
    })
    expect(validateOrgSettingsPatch({ name: '   ' })).toEqual({
      ok: false,
      message: 'name must not be empty',
    })
    expect(validateOrgSettingsPatch({ name: 42 })).toEqual({
      ok: false,
      message: 'name must be a string',
    })
  })

  test('accepts a name of exactly 120 characters and rejects 121', () => {
    expect(ORG_NAME_MAX_LENGTH).toBe(120)
    expect(validateOrgSettingsPatch({ name: 'a'.repeat(120) })).toEqual({
      ok: true,
      value: { name: 'a'.repeat(120) },
    })
    expect(validateOrgSettingsPatch({ name: 'a'.repeat(121) })).toEqual({
      ok: false,
      message: 'name must be at most 120 characters',
    })
  })

  test('rejects a timezone that is not a real IANA zone', () => {
    expect(validateOrgSettingsPatch({ timezone: 'Mars/Olympus' })).toEqual({
      ok: false,
      message: 'timezone must be a valid IANA time zone or null',
    })
    expect(validateOrgSettingsPatch({ timezone: '' })).toEqual({
      ok: false,
      message: 'timezone must be a valid IANA time zone or null',
    })
    expect(validateOrgSettingsPatch({ timezone: 42 })).toEqual({
      ok: false,
      message: 'timezone must be a valid IANA time zone or null',
    })
  })
})

// ── Route authorization ──────────────────────────────────────────────────────

const TEST_SERVICE_TOKEN = 'org-settings-test-token'
const ORG_ID = 'auth0|club-owner'
const COACH_ID = 'auth0|club-coach'
const ADMIN_ID = 'auth0|club-admin'
const STRANGER_ID = 'auth0|stranger'

const setToken = (value?: string) => {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

const stubbedOrg = (role: 'owner' | 'admin' | 'coach' | null): StubState => {
  const members: StubMember[] = [
    { member_auth0_id: ORG_ID, role: 'owner' },
    ...(role && role !== 'owner' ? [{ member_auth0_id: `auth0|club-${role}`, role }] : []),
  ]
  return {
    org: {
      auth0_id: ORG_ID,
      name: 'Riverside FC',
      timezone: 'America/New_York',
      created_at: '2026-01-02T03:04:05.000Z',
    },
    members,
  }
}

const settingsReq = (
  method: 'GET' | 'PATCH',
  body?: unknown,
  headers: Record<string, string> = {},
): Request =>
  new Request(`http://localhost/api/org/${encodeURIComponent(ORG_ID)}/settings`, {
    method,
    headers: {
      'x-service-token': TEST_SERVICE_TOKEN,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const guardHeaders = (verifiedAuth0Id: string) => ({
  'x-verified-auth0-id': verifiedAuth0Id,
})

afterEach(() => {
  setToken(undefined)
})

describe('PATCH /api/org/:auth0Id/settings authorization', () => {
  test('the org owner may update settings', async () => {
    setToken(TEST_SERVICE_TOKEN)
    useStub(stubbedOrg('owner'))

    const res = await settingsRoutes.handle(
      settingsReq('PATCH', { name: 'Riverside Athletic' }, guardHeaders(ORG_ID)),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { settings: { name: string } }
    expect(body.settings.name).toBe('Riverside Athletic')
  })

  test('an admin member may update settings', async () => {
    setToken(TEST_SERVICE_TOKEN)
    useStub(stubbedOrg('admin'))

    const res = await settingsRoutes.handle(
      settingsReq('PATCH', { timezone: 'Europe/London' }, guardHeaders(ADMIN_ID)),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { settings: { timezone: string } }
    expect(body.settings.timezone).toBe('Europe/London')
  })

  test('a coach member is denied with the role guard 403', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const state = useStub(stubbedOrg('coach'))

    const res = await settingsRoutes.handle(
      settingsReq('PATCH', { name: 'Hijacked' }, guardHeaders(COACH_ID)),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'Insufficient role for this organization',
      layer: 'server',
      retryable: false,
    })
    expect(state.org?.name).toBe('Riverside FC')
  })

  test('a caller with no org membership is denied by the identity guard', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const state = useStub(stubbedOrg('owner'))

    const res = await settingsRoutes.handle(
      settingsReq('PATCH', { name: 'Hijacked' }, guardHeaders(STRANGER_ID)),
    )

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN')
    expect(state.org?.name).toBe('Riverside FC')
  })

  test('a missing service token is rejected before the role floor', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const state = useStub(stubbedOrg('owner'))

    const res = await settingsRoutes.handle(
      settingsReq(
        'PATCH',
        { name: 'Hijacked' },
        { 'x-service-token': 'wrong', 'x-verified-auth0-id': ORG_ID },
      ),
    )

    expect(res.status).toBe(403)
    expect(((await res.json()) as { message: string }).message).toBe('Invalid service credentials')
    expect(state.org?.name).toBe('Riverside FC')
  })

  test('a missing verified identity is rejected', async () => {
    setToken(TEST_SERVICE_TOKEN)
    useStub(stubbedOrg('owner'))

    const res = await settingsRoutes.handle(settingsReq('PATCH', { name: 'Riverside Athletic' }))

    expect(res.status).toBe(403)
    expect(((await res.json()) as { message: string }).message).toBe('Missing verified identity')
  })

  test('an invalid patch is refused with 400 and never written', async () => {
    setToken(TEST_SERVICE_TOKEN)
    const state = useStub(stubbedOrg('owner'))

    const res = await settingsRoutes.handle(
      settingsReq('PATCH', { name: '' }, guardHeaders(ORG_ID)),
    )

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toBe('name must not be empty')
    expect(state.org?.name).toBe('Riverside FC')
  })
})

describe('GET /api/org/:auth0Id/settings', () => {
  test('any org member may read the settings', async () => {
    setToken(TEST_SERVICE_TOKEN)
    useStub(stubbedOrg('coach'))

    const res = await settingsRoutes.handle(settingsReq('GET', undefined, guardHeaders(COACH_ID)))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      settings: {
        name: 'Riverside FC',
        timezone: 'America/New_York',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
    })
  })

  test('an org with no stored row reads as empty settings', async () => {
    setToken(TEST_SERVICE_TOKEN)
    useStub({ org: null, members: [{ member_auth0_id: ORG_ID, role: 'owner' }] })

    const res = await settingsRoutes.handle(settingsReq('GET', undefined, guardHeaders(ORG_ID)))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      settings: { name: null, timezone: null, createdAt: null },
    })
  })

  test('a missing verified identity is rejected', async () => {
    setToken(TEST_SERVICE_TOKEN)
    useStub(stubbedOrg('owner'))

    const res = await settingsRoutes.handle(settingsReq('GET'))

    expect(res.status).toBe(403)
    expect(((await res.json()) as { message: string }).message).toBe('Missing verified identity')
  })
})
