/**
 * Team scope for the account tree — `/api/auth/user/:auth0Id/*`.
 *
 * `isOrgScopedPath` covers this family, so `serviceGuard` admits any member of
 * the org named in the path: that is membership, not authorization. Before this
 * module the tree had neither a capability check nor a scope check, which left
 * two distinct holes:
 *
 *  - the *account* id in this path is the org's own sub, and analysis rows are
 *    owned by the org, so an unfiltered read here is org-wide — a team coach's
 *    History page listed every player in the club, not just their own team;
 *  - the role list `AUTH_USER_ALLOWED_MEMBER_ROLES` says which roles may reach
 *    the tree, but nothing said which *players* they may then read.
 *
 * The split follows the org tree: a read of an out-of-scope target answers 404
 * so it is indistinguishable from a row that does not exist, while a write
 * answers 403 beside the capability gate it follows.
 */
import { resolveCaller, type Caller } from './caller'
import { canSeeStudent, visibleStudentIds } from './org/scope'
import { getAnalysisStudentId } from './analyses'
import { buildError } from './errors'
import type { CoachAIError } from '../types'

/** `null` means the caller sees the whole org and needs no narrowing. */
export type AccountScope = { caller: Caller; visible: string[] | null }

export type AccountScopeRefusal = {
  ok: false
  status: 404 | 403
  error: CoachAIError
}

export const resolveAccountScope = async (
  orgAuth0Id: string,
  request: Request,
  /** Pass a caller the route already resolved, to avoid a second role lookup. */
  caller?: Caller,
): Promise<AccountScope> => {
  const resolved = caller ?? (await resolveCaller(orgAuth0Id, request))
  return { caller: resolved, visible: await visibleStudentIds(orgAuth0Id, resolved.studentScope) }
}

const refusal = (status: 404 | 403, message: string): AccountScopeRefusal => ({
  ok: false,
  status,
  error: buildError(status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message, false),
})

/**
 * Gate a job-keyed account-tree request. The row's own `student_id` is the
 * scope key, so an analysis with no student belongs to whoever uploaded it and
 * is visible to any member of the org that owns it.
 *
 * A job that does not exist, and a job about a player the caller may not see,
 * are answered identically — otherwise the 404/403 split becomes an oracle for
 * which job ids are real.
 */
export const accountJobScope = async (
  orgAuth0Id: string,
  jobId: string,
  request: Request,
  mode: 'read' | 'write',
  caller?: Caller,
): Promise<{ ok: true; scope: AccountScope } | AccountScopeRefusal> => {
  const scope = await resolveAccountScope(orgAuth0Id, request, caller)
  // Org-wide caller: nothing to narrow, and no need to pay for the lookup.
  if (scope.visible === null) return { ok: true, scope }

  const { found, studentId } = await getAnalysisStudentId(orgAuth0Id, jobId)
  if (!found) {
    return refusal(404, 'Analysis not found')
  }
  if (studentId !== null && !canSeeStudent(scope.visible, studentId)) {
    return mode === 'read'
      ? refusal(404, 'Analysis not found')
      : refusal(403, 'That analysis is outside your team scope')
  }
  return { ok: true, scope }
}
