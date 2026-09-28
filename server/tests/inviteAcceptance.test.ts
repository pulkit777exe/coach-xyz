// acceptInvite used to consume the token and then write the membership, discarding
// the write's result. `inviteOrgMember` has four `return null` paths, so a single
// failed membership write produced `{ ok: true }` — the UI told the user they were
// in the club — while every org route then 403'd them, because `getMemberRole`
// returned null. And because the single-use token was already burnt there was no
// retry: the one action that could fix it no longer worked.
//
// The probe drives both halves through the real `acceptInvite`: the membership
// write failing, and the token still being usable afterwards.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const SERVER_DIR = join(import.meta.dir, '..')
const PROBE = join(import.meta.dir, 'inviteAcceptanceProbe.ts')

type ProbeResult = {
  first: { ok: boolean; error?: string; orgAuth0Id?: string }
  second: { ok: boolean; error?: string; orgAuth0Id?: string }
  memberCalls: number
  /** Did the second accept find the token still open? */
  secondSawToken: boolean
}

type MemberMode = '0' | '1' | 'recover'

const runProbe = (membershipSucceeds: MemberMode): ProbeResult => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  env.SERVICE_TOKEN = ''
  env.DATABASE_URL = ''
  env.INVITE_PROBE_MEMBER_OK = membershipSucceeds

  const proc = Bun.spawnSync({
    cmd: [process.execPath, PROBE],
    cwd: SERVER_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  expect(proc.exitCode, `probe failed:\n${stdout}\n${stderr}`).toBe(0)
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '') as ProbeResult
}

describe('acceptInvite', () => {
  test('a failed membership write is reported as a failure, not a success', () => {
    // The bug: this returned { ok: true } while no membership row existed.
    const r = runProbe('0')
    expect(r.first.ok).toBe(false)
    expect(r.first.error).toBe('Could not complete the invitation')
    expect(r.first.orgAuth0Id).toBeUndefined()
  })

  test('a failed membership write leaves the token usable for a retry', () => {
    // The other half of the bug: the token was consumed first, so the user had no
    // way to recover. The second accept must still find it open...
    const r = runProbe('0')
    expect(r.secondSawToken, 'the invite row was still readable on retry').toBe(true)
    // ...and the write must actually be re-attempted, which is what "usable" means.
    expect(r.memberCalls).toBe(2)
  })

  test('a transient failure recovers on the retry', () => {
    // The end-to-end proof: the first write fails, the token survives, the retry
    // writes the membership and the user ends up in the org. Under the old
    // consume-then-write order the retry could only report "invalid or expired".
    const r = runProbe('recover')
    expect(r.first.ok).toBe(false)
    expect(r.second.ok).toBe(true)
    expect(r.second.orgAuth0Id).toBe('auth0|org-owner')
    expect(r.memberCalls).toBe(2)
  })

  test('a successful accept consumes the token exactly once', () => {
    const r = runProbe('1')
    expect(r.first.ok).toBe(true)
    expect(r.first.orgAuth0Id).toBe('auth0|org-owner')
    // The second attempt with a working membership write must not find the token.
    expect(r.secondSawToken).toBe(false)
    expect(r.second.ok).toBe(false)
    expect(r.second.error).toBe('Invalid or expired invitation')
  })

  test('the membership is written before the token is consumed', () => {
    // Ordering, asserted through the call counts. On the success path the write
    // happens once and the second accept never reaches it, because the token was
    // consumed only after the membership existed.
    expect(runProbe('1').memberCalls).toBe(1)
    // On the failure path it is attempted twice — once per accept — because the
    // first attempt left the token open.
    expect(runProbe('0').memberCalls).toBe(2)
  })
})
