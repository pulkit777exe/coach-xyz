/**
 * Initials for an avatar, from a display name — or from an email when there is no name.
 *
 * A SINGLE implementation, replacing SEVEN copies across the app, which had FOUR
 * different behaviours:
 *
 *   first+LAST              ×3   app/dashboard/org, MembersSection, buildSettingsSections
 *   first+SECOND            ×2   StudentsClient, StudentProfile — a middle name stole the
 *                                   second initial, so `"Ada Byron King"` read `AB`
 *   substring(0,2) 1-word   ×1   OwnerHome — so `Cher` read `CH` in one place and `C` in
 *                                   another
 *   email fallback + `'?'`  ×1   `UserAvatar.getInitials`
 *
 * The observable defect: **the same player rendered a different avatar on the roster and
 * on their profile.** Nothing tested any of the seven, which is why copies drifted rather
 * than converged.
 *
 * `source` is the second argument because two callers (`SidebarProfileMenu.tsx:83` and
 * `HeaderClient.tsx:345`) pass an email SPECIFICALLY to reach the fallback — a member with
 * no name on file still gets an avatar. `fallback` exists because `OwnerHome` rendered
 * `'?'` for exactly that case, deliberately.
 */
export function initials(
  name: string | null | undefined,
  source?: string | null,
  fallback = '',
): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length > 0) {
    const first = parts[0].charAt(0)
    const last = parts.length >= 2 ? parts[parts.length - 1].charAt(0) : ''
    return (first + last).toUpperCase()
  }
  // No usable name: fall back to the email's first two characters, as `UserAvatar` did.
  const fromEmail = (source ?? '').trim()
  if (fromEmail) return fromEmail.substring(0, 2).toUpperCase()
  return fallback
}
