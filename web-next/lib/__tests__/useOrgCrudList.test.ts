import { describe, expect, it } from 'vitest'

import { crudErrorMessage, crudListInit, crudListReducer } from '../useOrgCrudList'

type Item = { id: string; title: string }

const item = (id: string, title = id): Item => ({ id, title })

describe('crudListReducer', () => {
  it('starts empty, unloaded, idle, and error-free', () => {
    expect(crudListInit<Item>()).toEqual({
      items: [],
      hasLoaded: false,
      isBusy: false,
      error: null,
    })
  })

  it('loads items and marks the list loaded', () => {
    const next = crudListReducer(crudListInit<Item>(), { type: 'loaded', items: [item('a')] })
    expect(next.items).toEqual([item('a')])
    expect(next.hasLoaded).toBe(true)
  })

  it('clears items on load failure but still marks the list loaded', () => {
    const seeded = { ...crudListInit<Item>(), items: [item('stale')] }
    const next = crudListReducer(seeded, { type: 'loadFailed' })
    expect(next.items).toEqual([])
    expect(next.hasLoaded).toBe(true)
  })

  it('prepends created items ahead of existing ones', () => {
    const seeded = { ...crudListInit<Item>(), items: [item('old')] }
    const next = crudListReducer(seeded, { type: 'created', item: item('new') })
    expect(next.items.map((i) => i.id)).toEqual(['new', 'old'])
  })

  it('replaces only the updated item by id', () => {
    const seeded = { ...crudListInit<Item>(), items: [item('a', 'A'), item('b', 'B')] }
    const next = crudListReducer(seeded, { type: 'updated', item: item('b', 'B2') })
    expect(next.items).toEqual([item('a', 'A'), item('b', 'B2')])
  })

  it('removes only the deleted id', () => {
    const seeded = { ...crudListInit<Item>(), items: [item('a'), item('b')] }
    const next = crudListReducer(seeded, { type: 'removed', id: 'a' })
    expect(next.items).toEqual([item('b')])
  })

  it('toggles busy without touching items', () => {
    const seeded = { ...crudListInit<Item>(), items: [item('a')] }
    expect(crudListReducer(seeded, { type: 'busy', busy: true }).isBusy).toBe(true)
    expect(crudListReducer(seeded, { type: 'busy', busy: true }).items).toEqual([item('a')])
  })

  it('sets and clears the error', () => {
    const failed = crudListReducer(crudListInit<Item>(), { type: 'failed', message: 'nope' })
    expect(failed.error).toBe('nope')
    expect(crudListReducer(failed, { type: 'clearError' }).error).toBeNull()
  })
})

describe('crudErrorMessage', () => {
  it('prefers the Error message', () => {
    expect(crudErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('falls back for non-errors and blank messages', () => {
    expect(crudErrorMessage('nope', 'fallback')).toBe('fallback')
    expect(crudErrorMessage(new Error(''), 'fallback')).toBe('fallback')
    expect(crudErrorMessage(null, 'fallback')).toBe('fallback')
  })
})
