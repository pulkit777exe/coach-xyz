// Pure helpers behind cross-device preference sync. Kept out of the provider
// so the decisions are unit-testable without a DOM or a React renderer.

import type { UserSettings } from './meApi'
import type { Preferences } from './preferences'

/** Only the three preferences that follow the user across devices. */
export type SyncedPreferences = Pick<Preferences, 'theme' | 'reduceMotion' | 'weekStartsMonday'>

/**
 * A missing row (`updatedAt: null`) means the account has never saved a
 * preference. Adopting then would overwrite a choice this device just made with
 * the default, so the caller keeps local values and lets the first real change
 * create the row.
 */
export function hasStoredUserSettings(settings: Pick<UserSettings, 'updatedAt'>): boolean {
  return settings.updatedAt !== null
}

/** The account's values win when a row exists — that is the whole point of syncing. */
export function adoptUserSettings(settings: UserSettings): SyncedPreferences {
  return {
    theme: settings.theme,
    reduceMotion: settings.reduceMotion,
    weekStartsMonday: settings.weekStartsMonday,
  }
}

/** The patch written on every local change (no `updatedAt` — server-owned). */
export function toSyncedPatch(prefs: SyncedPreferences): Omit<UserSettings, 'updatedAt'> {
  return {
    theme: prefs.theme,
    reduceMotion: prefs.reduceMotion,
    weekStartsMonday: prefs.weekStartsMonday,
  }
}
