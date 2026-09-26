// Seed local end-to-end personas: real org rows, real session cookies, no Auth0.
//
// Why this exists: verifying role-based UI needs several distinct logins (owner,
// head coach, assistant coach, coach, analyst, medical, player). The obvious
// tool — the Auth0 Management API — needs an M2M application with read:users /
// create:users that nobody has granted this tenant.
//
// It is also unnecessary. `@auth0/nextjs-auth0` v4 ships a first-party testing
// helper, `generateSessionCookie` (the `./testing` subpath export), which mints a
// byte-identical `__session` JWE from AUTH0_SECRET alone. `getSession()` only
// decrypts that cookie — it never calls /userinfo or the JWKS — and this app
// never calls getAccessToken(), so a minted cookie is a complete session.
//
// So a persona is two things, neither of which needs Auth0:
//   1. a `users` + `org_members` row pair, written through the app's own API
//      using the shared SERVICE_TOKEN (exactly as scripts/smokeOrgHttp.ts does);
//   2. a `__session` cookie minted locally from AUTH0_SECRET.
//
// That makes this hermetic, offline, instant, and immune to Auth0's signup
// throttles and bot detection. Auth0's own repo has its real-login Playwright
// job disabled, which is the same lesson.
//
// SAFETY: this can mint a session for ANY sub, so it can impersonate anyone. It
// is a local test harness. It refuses to run against a production tenant, and
// the credentials and session files it writes are gitignored.
//
// Usage:
//   node scripts/seedPersonas.mjs              # seed rows + write session files
//   node scripts/seedPersonas.mjs --sessions   # only re-mint session files

import { generateSessionCookie } from '@auth0/nextjs-auth0/testing'
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const WEB_ROOT = path.join(HERE, '..')
const SESSION_DIR = path.join(WEB_ROOT, '.personas')
const API = process.env.SERVER_API_URL ?? 'http://localhost:8000'
const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000'
const SESSIONS_ONLY = process.argv.includes('--sessions')

/** Read a KEY=value from a .env file without adding a dotenv dependency. */
function readEnv(file, key) {
  if (!fs.existsSync(file)) return undefined
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(new RegExp(`^${key}=(.*)$`))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

const AUTH0_SECRET =
  process.env.AUTH0_SECRET ?? readEnv(path.join(WEB_ROOT, '.env'), 'AUTH0_SECRET')
const AUTH0_DOMAIN =
  process.env.AUTH0_DOMAIN ?? readEnv(path.join(WEB_ROOT, '.env'), 'AUTH0_DOMAIN')
const SERVICE_TOKEN =
  process.env.SERVICE_TOKEN ?? readEnv(path.join(WEB_ROOT, '..', 'server', '.env'), 'SERVICE_TOKEN')

for (const [name, value] of [
  ['AUTH0_SECRET', AUTH0_SECRET],
  ['AUTH0_DOMAIN', AUTH0_DOMAIN],
  ['SERVICE_TOKEN', SERVICE_TOKEN],
]) {
  if (!value) {
    console.error(`${name} is not set — cannot seed personas.`)
    process.exit(1)
  }
}

// A production tenant can mint sessions for anyone, so refuse to run there.
if (/\.(auth0\.com|com)$/.test(AUTH0_DOMAIN) === false && AUTH0_DOMAIN.includes('.com')) {
  console.error(`AUTH0_DOMAIN looks like a custom production domain (${AUTH0_DOMAIN}). Refusing.`)
  process.exit(1)
}

// Two teams on purpose: cross-team isolation is the thing these personas exist to
// verify, and it is untestable with one team. Org staff (analyst, medical) are
// deliberately team-less, because the policy makes them org-wide readers.
const PERSONAS = [
  { key: 'owner', role: 'owner', team: null, name: 'Persona Owner' },
  { key: 'headcoach', role: 'head_coach', team: 'A', name: 'Persona Head Coach' },
  { key: 'coach', role: 'coach', team: 'A', name: 'Persona Coach' },
  { key: 'assistant', role: 'assistant_coach', team: 'A', name: 'Persona Assistant' },
  { key: 'othercoach', role: 'coach', team: 'B', name: 'Persona Other Coach' },
  { key: 'analyst', role: 'analyst', team: null, name: 'Persona Analyst' },
  { key: 'medical', role: 'medical', team: null, name: 'Persona Medical' },
  { key: 'player', role: 'player', team: null, name: 'Persona Player' },
]

for (const p of PERSONAS) {
  // Deterministic so re-runs are idempotent upserts, not a new generation of
  // identities. The sub is what org_members is keyed on.
  p.sub = `auth0|e2e-${p.key}`
  p.email = `e2e-${p.key}@personas.example.com`
}

// The club org is keyed by the owner's own sub — that is the org the app
// creates for them on first login — so it is known before any request is made.
const orgId = PERSONAS[0].sub

const call = async (method, url, body, identity) => {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-service-token': SERVICE_TOKEN,
      'x-verified-auth0-id': identity,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* some routes answer with no body */
  }
  return { status: res.status, json }
}

let failures = 0
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.error(
      `  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail).slice(0, 220)}`}`,
    )
  }
}

if (!SESSIONS_ONLY) {
  console.log('users')
  for (const p of PERSONAS) {
    // The row that makes the persona invitable by email.
    const r = await call(
      'POST',
      '/api/auth/sync',
      {
        sub: p.sub,
        name: p.name,
        email: p.email,
        email_verified: true,
      },
      p.sub,
    )
    check(`${p.key} user row`, r.status === 200, r.json)
  }

  const owner = PERSONAS[0]
  console.log('org')
  // The org is created implicitly by ensureOrgOwner on the first org-scoped call.
  const bootstrap = await call('GET', `/api/org/${owner.sub}/students`, undefined, owner.sub)
  check('owner org bootstrapped', bootstrap.status === 200, bootstrap.json)

  console.log('members')
  for (const p of PERSONAS.filter((x) => x.role !== 'owner')) {
    const r = await call(
      'POST',
      `/api/org/${orgId}/members`,
      { email: p.email, role: p.role },
      owner.sub,
    )
    // 201 on a fresh invite; 400 if it already exists, which is fine on a re-run.
    check(`${p.key} invited as ${p.role}`, r.status === 201 || r.status === 400, r.json)
  }

  console.log('teams')
  const teamIds = {}
  const listed = await call('GET', `/api/org/${orgId}/teams`, undefined, owner.sub)
  for (const letter of ['A', 'B']) {
    const name = `Persona Squad ${letter}`
    const found = (listed.json?.teams ?? []).find((t) => t.name === name)
    if (found) {
      teamIds[letter] = found.id
      check(`team ${letter} exists`, true)
      continue
    }
    const r = await call('POST', `/api/org/${orgId}/teams`, { name, sport: 'soccer' }, owner.sub)
    teamIds[letter] = r.json?.team?.id
    check(`team ${letter} created`, r.status === 201, r.json)
  }

  console.log('team membership')
  const roster = await call('GET', `/api/org/${orgId}/members`, undefined, owner.sub)
  const byEmail = new Map(
    (roster.json?.members ?? []).map((m) => [
      String(m.member_email ?? '').toLowerCase(),
      m.auth0_id ?? m.member_auth0_id,
    ]),
  )
  for (const p of PERSONAS.filter((x) => x.team)) {
    const auth0Id = byEmail.get(p.email.toLowerCase()) ?? p.sub
    const r = await call(
      'POST',
      `/api/org/${orgId}/teams/${teamIds[p.team]}/members`,
      { member_auth0_id: auth0Id, role: 'coach' },
      owner.sub,
    )
    check(`${p.key} added to team ${p.team}`, r.status === 201 || r.status === 400, r.json)
  }

  console.log('verify')
  // A persona must have exactly one org: the club. resolveOrgContext in
  // web-next/lib/orgContext.ts prefers an org the caller OWNS over one they were
  // invited to (`orgs.find(o => o.org_auth0_id === ownSub && o.role === 'owner')`
  // beats `orgs[0]`), so a stray personal org routes the persona into an empty
  // one and every assertion below silently describes the wrong org. The members
  // API cannot clean this up — it refuses to remove an org owner by design — so
  // this verifies rather than repairs, and names the fix if it trips.
  const clubMembers = await call('GET', `/api/org/${owner.sub}/members`, undefined, owner.sub)
  const clubSubs = new Set(
    (clubMembers.json?.members ?? []).map((m) => m.auth0_id ?? m.member_auth0_id).filter(Boolean),
  )
  for (const p of PERSONAS.filter((x) => x.role !== 'owner')) {
    if (clubSubs.has(p.sub)) {
      console.log(`  ok  ${p.key} is a member of the club org`)
    } else {
      console.error(
        `  FAIL ${p.key} is not a member of ${owner.sub}. If the persona also owns a ` +
          `personal org, the app will route them there instead — delete the ` +
          `organizations + org_members rows for ${p.sub} and re-run.`,
      )
      failures += 1
    }
  }

  console.log(`\norg: ${orgId}`)
  console.log(`team A: ${teamIds.A ?? '(none)'}   team B: ${teamIds.B ?? '(none)'}`)
}

console.log('sessions')
fs.mkdirSync(SESSION_DIR, { recursive: true })
for (const p of PERSONAS) {
  const value = await generateSessionCookie(
    {
      user: {
        sub: p.sub,
        email: p.email,
        email_verified: true,
        name: p.name,
        nickname: p.key,
        picture: '',
      },
      tokenSet: {
        // Far future: getSession never reads this, but if the app ever calls
        // getAccessToken() a near expiry would trigger a refresh against Auth0.
        accessToken: 'e2e-access-token',
        refreshToken: 'e2e-refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      },
    },
    { secret: AUTH0_SECRET },
  )
  const file = path.join(SESSION_DIR, `${p.key}.json`)
  // Playwright storageState shape, so this drops straight into a project config.
  //
  // The org cookie is what makes the persona deterministic. Every user gets an
  // org of their own on first login (`/api/auth/sync` calls ensureOrg — "first
  // login forms the org"), and resolveOrgContext in web-next/lib/orgContext.ts
  // prefers an org the caller OWNS over one they were invited to. Without the
  // cookie, an invited coach is routed into their own empty org instead of the
  // club, and every UI assertion silently describes the wrong org. The cookie is
  // the app's own supported "which org am I working in" mechanism, so setting it
  // is a fixture concern, not a workaround.
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        cookies: [
          {
            name: '__session',
            value,
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
            expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
          },
          {
            name: 'coach_org',
            value: encodeURIComponent(orgId),
            domain: 'localhost',
            path: '/',
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
            expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
          },
        ],
        origins: [],
      },
      null,
      1,
    ),
  )
  fs.chmodSync(file, 0o600)
  console.log(`  ok  ${p.key} (${p.role}) -> ${path.relative(process.cwd(), file)}`)
}

console.log(
  `\nMinted sessions expire in 1h by helper design (maxAge is hardcoded), so re-run ` +
    `--sessions before a long session. Files in ${path.relative(process.cwd(), SESSION_DIR)}/ are gitignored.`,
)
process.exit(failures > 0 ? 1 : 0)
