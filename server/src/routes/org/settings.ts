import { orgSettings, updateOrgSettings, validateOrgSettingsPatch } from '../../lib/orgData'
import { auditRoute } from '../../lib/audit'
import { buildError } from '../../lib/errors'
import { orgRoleGuard, serviceGuard } from '../../lib/serviceGuard'
import type { OrgMemberRole } from '../../lib/orgMembers'
import { Elysia } from 'elysia'

// ── Organization settings ────────────────────────────────────────────────────
// Reads are open to every role the org tree already admits (the app-level
// orgRoleGuard in index.ts covers the whole /api/org/* family — players use the
// self-scoped /api/me/* routes instead). Writes narrow to owner/admin: the same
// floor members.ts and teams.ts use for membership and team deletion, because a
// name and a calendar are org-wide facts, not a member's own.
const ORG_SETTINGS_WRITE_ROLES: readonly OrgMemberRole[] = ['owner', 'admin']

export default new Elysia()
  .use(serviceGuard)
  .get('/api/org/:auth0Id/settings', async ({ params, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    set.status = 200
    return { settings: await orgSettings(auth0Id) }
  })
  .use(
    new Elysia()
      .use(orgRoleGuard(ORG_SETTINGS_WRITE_ROLES))
      .patch('/api/org/:auth0Id/settings', async ({ params, body, request, set }) => {
        const { auth0Id } = params
        if (!auth0Id) {
          set.status = 400
          return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
        }
        const validated = validateOrgSettingsPatch(body)
        if (!validated.ok) {
          set.status = 400
          return buildError('INVALID_REQUEST', validated.message, false)
        }
        const settings = await updateOrgSettings(auth0Id, validated.value)
        if (!settings) {
          set.status = 500
          return buildError('INTERNAL_ERROR', 'Could not update organization settings', true)
        }
        auditRoute(request, auth0Id, 'settings.changed', 'organization', auth0Id, {
          name: settings.name,
          timezone: settings.timezone,
        })
        set.status = 200
        return { settings }
      }),
  )
