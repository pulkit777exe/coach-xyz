import { Elysia } from 'elysia'

import { getUserAnalysisById } from '../lib/analyses'
import {
  MAX_CLIPS_PER_ANALYSIS,
  countClips,
  createClip,
  deleteClip,
  listClips,
  parseClipInput,
} from '../lib/clips'
import { checkClipLimit, getIP, rateLimited } from '../lib/ratelimit'
import { buildError } from '../lib/errors'
import { serviceGuard } from '../lib/serviceGuard'
import { resolveCaller } from '../lib/caller'
import { auditRoute } from '../lib/audit'

// Clips routes (split from routes/auth.ts): subclip bookmarks on the rendered
// video. Curatorial like finding review: owner self-passes, members need
// finding.review.
export default new Elysia()
  .use(serviceGuard)
  .get('/api/auth/user/:auth0Id/analyses/:jobId/clips', async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    set.status = 200
    return { clips: await listClips(auth0Id, jobId) }
  })
  .post('/api/auth/user/:auth0Id/analyses/:jobId/clips', async ({ params, body, request, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.verified) {
      set.status = 403
      return buildError('FORBIDDEN', 'Missing verified identity', false)
    }
    if (caller.verified !== auth0Id && !caller.can('finding.review')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Clip creation requires the finding.review permission', false)
    }
    const { allowed, reset } = await checkClipLimit(caller.verified ?? getIP(request))
    if (!allowed) {
      return rateLimited(
        set,
        'Too many clip writes. Try again later.',
        Math.ceil((reset - Date.now()) / 1000),
      )
    }
    const parsed = parseClipInput((body ?? {}) as Record<string, unknown>)
    if (!parsed.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', parsed.reason, false)
    }
    const existing = await getUserAnalysisById(auth0Id, jobId)
    if (!existing) {
      set.status = 404
      return buildError('NOT_FOUND', 'Analysis not found', false)
    }
    if ((await countClips(auth0Id, jobId)) >= MAX_CLIPS_PER_ANALYSIS) {
      set.status = 409
      return buildError('INVALID_REQUEST', 'Clip limit reached for this analysis', false)
    }
    const clip = await createClip(auth0Id, jobId, parsed.cleaned, caller.verified)
    if (!clip) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Could not create clip (unknown finding?)', false)
    }
    auditRoute(request, auth0Id, 'clip.created', 'clip', clip.id, { jobId })
    set.status = 201
    return { clip }
  })
  .delete(
    '/api/auth/user/:auth0Id/analyses/:jobId/clips/:clipId',
    async ({ params, request, set }) => {
      const { auth0Id, jobId, clipId } = params
      if (!auth0Id || !jobId || !clipId) {
        set.status = 400
        return buildError('INVALID_REQUEST', 'Missing required parameters', false)
      }
      const caller = await resolveCaller(auth0Id, request)
      if (!caller.verified) {
        set.status = 403
        return buildError('FORBIDDEN', 'Missing verified identity', false)
      }
      if (caller.verified !== auth0Id && !caller.can('finding.review')) {
        set.status = 403
        return buildError(
          'FORBIDDEN',
          'Clip deletion requires the finding.review permission',
          false,
        )
      }
      const { allowed, reset } = await checkClipLimit(caller.verified ?? getIP(request))
      if (!allowed) {
        return rateLimited(
          set,
          'Too many clip writes. Try again later.',
          Math.ceil((reset - Date.now()) / 1000),
        )
      }
      const removed = await deleteClip(auth0Id, jobId, clipId)
      if (!removed) {
        set.status = 404
        return buildError('NOT_FOUND', 'Clip not found', false)
      }
      auditRoute(request, auth0Id, 'clip.deleted', 'clip', clipId, { jobId })
      set.status = 200
      return { deleted: true }
    },
  )
