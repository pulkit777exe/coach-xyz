import { toIsoString } from './isoTime'
import { orDisabledDefault, withHistoryStore, withHistoryStoreOrThrow } from './historyStore'
import { auditRoute } from './audit'
import { buildError, type CoachAIError } from './errors'
import { logger } from './logger'

// ── Player consent ──────────────────────────────────────────────────────────
// One row per linked player (`player_consents`, keyed by student_id), holding
// one boolean per processing purpose plus the policy version that was on
// display when the player answered. Consent is the PLAYER's record, never an
// org field, so every function here is keyed by the student row the caller is
// linked to — the route resolves that link (and rejects an unlinked caller)
// before it gets here.

/**
 * The policy version a row created now is stamped with. Mirrors the column
 * default in ensureInitialized (historyStore.ts owns the DDL).
 */
export const CONSENT_POLICY_VERSION = '2026-09-26'

/** The three purposes, in the order the settings UI lists them. */
export const CONSENT_PURPOSES = ['trainingData', 'medicalData', 'marketing'] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export type PlayerConsent = {
  /** False when the account has no linked player row: nothing can be recorded. */
  linked: boolean
  /** Present only when linked — the player row the consent belongs to. */
  studentId?: string
  policyVersion: string
  trainingData: boolean
  medicalData: boolean
  marketing: boolean
  updatedAt: string | null
}

export type ConsentPatch = {
  trainingData?: boolean
  medicalData?: boolean
  marketing?: boolean
}

type ConsentRow = {
  student_id: string
  training_data: boolean
  medical_data: boolean
  marketing: boolean
  policy_version: string
  updated_at: string | Date
}

/**
 * The answer for a linked player who has never recorded consent: every purpose
 * denied. Mirrors the column defaults — consent is opt-in, so an absent row
 * must never read as permission.
 */
export const defaultConsent = (studentId: string): PlayerConsent => ({
  linked: true,
  studentId,
  policyVersion: CONSENT_POLICY_VERSION,
  trainingData: false,
  medicalData: false,
  marketing: false,
  updatedAt: null,
})

/**
 * The answer for an account with no linked player. A read, not an error: the
 * consent screen must render for a coach-only account too, and the only thing
 * it can honestly say is "no linked player, nothing recorded".
 */
export const unlinkedConsent = (): PlayerConsent => ({
  linked: false,
  policyVersion: CONSENT_POLICY_VERSION,
  trainingData: false,
  medicalData: false,
  marketing: false,
  updatedAt: null,
})

const toConsent = (row: ConsentRow): PlayerConsent => ({
  linked: true,
  studentId: row.student_id,
  policyVersion: row.policy_version,
  // Only an explicit `true` counts as consent: a hand-edited row, a future
  // column default, or a store that returns nulls must not read as permission.
  trainingData: row.training_data === true,
  medicalData: row.medical_data === true,
  marketing: row.marketing === true,
  updatedAt: toIsoString(row.updated_at),
})

/**
 * Read one linked player's recorded consent. A missing row (or an unavailable
 * store) is the all-denied default: signing in must never imply consent, and a
 * disabled store must not block the settings screen.
 */
export const consentForStudent = async (studentId: string): Promise<PlayerConsent> => {
  const stored = await withHistoryStore(async (db) => {
    const rows = await db<ConsentRow[]>`
      select student_id, training_data, medical_data, marketing, policy_version, updated_at
      from player_consents
      where student_id = ${studentId}::uuid
      limit 1;
    `
    return rows?.[0] ?? null
  })

  return orDisabledDefault(stored ? toConsent(stored) : null, defaultConsent(studentId))
}

/**
 * Upsert a partial consent patch, preserving every omitted purpose. Consent is
 * written per purpose so a player can withdraw one use without re-answering the
 * others.
 */
export const upsertConsent = async (
  studentId: string,
  patch: ConsentPatch,
): Promise<PlayerConsent | null> => {
  return withHistoryStoreOrThrow(async (db) => {
    // Read-merge-write for the same reason as the other settings writes: an
    // omitted purpose must survive, and Bun's parameter serializer cannot do a
    // Postgres-side `coalesce(excluded.x, player_consents.x)` merge here.
    const existing = await db<ConsentRow[]>`
      select student_id, training_data, medical_data, marketing, policy_version, updated_at
      from player_consents
      where student_id = ${studentId}::uuid
      limit 1;
    `
    const current = existing?.[0] ? toConsent(existing[0]) : defaultConsent(studentId)

    const next = {
      trainingData: patch.trainingData ?? current.trainingData,
      medicalData: patch.medicalData ?? current.medicalData,
      marketing: patch.marketing ?? current.marketing,
    }

    const rows = await db<ConsentRow[]>`
      insert into player_consents (
        student_id, training_data, medical_data, marketing, policy_version, updated_at
      )
      values (
        ${studentId}::uuid,
        ${next.trainingData},
        ${next.medicalData},
        ${next.marketing},
        ${current.policyVersion},
        now()
      )
      on conflict (student_id) do update set
        training_data = excluded.training_data,
        medical_data = excluded.medical_data,
        marketing = excluded.marketing,
        updated_at = excluded.updated_at
      returning student_id, training_data, medical_data, marketing, policy_version, updated_at;
    `
    const row = rows?.[0]
    return row ? toConsent(row) : null
  })
}

export type ConsentValidation = { ok: true; value: ConsentPatch } | { ok: false; message: string }

/**
 * How strictly recorded consent gates writes. `off` skips every check,
 * `warn` logs + audits and proceeds, `enforce` rejects with 409
 * CONSENT_REQUIRED. Default `warn`: the gap is surfaced without breaking
 * coaching flows that predate consent records. Changing the default is a
 * product decision, not a code cleanup — STOP and get approval first.
 */
export type ConsentEnforcement = 'off' | 'warn' | 'enforce'

export const consentEnforcement = (): ConsentEnforcement => {
  const raw = (process.env.CONSENT_ENFORCEMENT ?? 'warn').trim().toLowerCase()
  if (raw === 'enforce') return 'enforce'
  if (raw === 'off') return 'off'
  return 'warn'
}

/**
 * Enforce one consent purpose on a write. Reads — notably the medical role —
 * never pass through here. `off` proceeds silently; `warn` logs, audits
 * (existing `settings.changed` action, so no vocabulary change), and
 * proceeds; `enforce` answers 409 CONSENT_REQUIRED.
 */
export const gateConsentWrite = async (input: {
  request: Request
  orgAuth0Id: string
  studentId: string
  granted: boolean
  purpose: Extract<ConsentPurpose, 'medicalData' | 'trainingData'>
  action: string
}): Promise<{ ok: true } | { ok: false; status: 409; error: CoachAIError }> => {
  if (input.granted) return { ok: true }
  const mode = consentEnforcement()
  if (mode === 'off') return { ok: true }
  logger.warn('consent_gate_hit', {
    type: 'consent_gate_hit',
    org: input.orgAuth0Id,
    studentId: input.studentId,
    purpose: input.purpose,
    mode,
    action: input.action,
  })
  auditRoute(
    input.request,
    input.orgAuth0Id,
    'settings.changed',
    'player_consent',
    input.studentId,
    {
      purpose: input.purpose,
      mode,
      action: input.action,
    },
  )
  if (mode === 'enforce') {
    return {
      ok: false,
      status: 409,
      error: buildError(
        'CONSENT_REQUIRED',
        `Consent for ${input.purpose === 'medicalData' ? 'medical data' : 'training data'} is required`,
        false,
      ),
    }
  }
  return { ok: true }
}

/** Erase one player's recorded consent (privacy-request execution). */
export const deleteConsent = async (studentId: string): Promise<boolean> => {
  const res = await withHistoryStoreOrThrow(async (db) => {
    const rows = await db<{ student_id: string }[]>`
      delete from player_consents where student_id = ${studentId}::uuid returning student_id;
    `
    return Boolean(rows?.[0])
  })
  return res ?? false
}

/** Strict manual validation matching the existing server route conventions. */
export const validateConsentPatch = (body: unknown): ConsentValidation => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Body must be a JSON object' }
  }

  const value = body as Record<string, unknown>
  const unknownField = Object.keys(value).find(
    (key) => !(CONSENT_PURPOSES as readonly string[]).includes(key),
  )
  if (unknownField) {
    return { ok: false, message: `Unknown field: ${unknownField}` }
  }
  const nonBoolean = CONSENT_PURPOSES.find((purpose) => {
    const field = value[purpose]
    return field !== undefined && typeof field !== 'boolean'
  })
  if (nonBoolean) {
    return { ok: false, message: `${nonBoolean} must be a boolean` }
  }

  return {
    ok: true,
    value: Object.fromEntries(
      CONSENT_PURPOSES.filter((purpose) => value[purpose] !== undefined).map((purpose) => [
        purpose,
        value[purpose],
      ]),
    ) as ConsentPatch,
  }
}
